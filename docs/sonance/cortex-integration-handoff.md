# Cortex Integration Handoff — Athena Gateway ↔ Cortex

**Date**: 2026-03-06 (updated with answers)
**From**: Athena Gateway Team (Josh)
**To**: Cortex Platform Team
**Status**: RESOLVED — Token exchange verified, gateway-side conflicts fixed, ready for Teams testing

---

## 1. What We're Building

Athena is a company AI assistant running on the OpenClaw gateway framework. It
connects to users via **Microsoft Teams** (Bot Framework). When a user says
"what's on my calendar", Athena needs to call M365 tools (calendar, email, etc.)
through Cortex, using that **specific user's** OAuth tokens.

**Cortex instance**: `https://cortex-bice.vercel.app`
**Service API key**: `ctx_12e4abb9_5dbc41d18bb9f28044a66ecd7a1c066b23e4abf5964a1d860d2b801a33f2f8d8`

---

## 2. Architecture (How We Call Cortex)

```
MS Teams User → Bot Framework → Athena Gateway → Cortex
                                    │
                                    ├── Apollo /v1/messages  (LLM proxy — working ✓)
                                    │
                                    └── MCP Bridge /mcp/cortex  (tool execution — BROKEN)
                                         │
                                         ├── JSON-RPC: tools/list  (discover tools — working ✓)
                                         └── JSON-RPC: tools/call  (execute tool — auth issue)
```

### Tool discovery flow (working)

1. Gateway starts → calls `POST /mcp/cortex` with `{"method": "tools/list"}`
2. Cortex returns 39 M365 tools (list_events, list_emails, etc.)
3. Gateway registers them as `cortex_m365__list_events`, `cortex_m365__list_emails`, etc.

### Tool execution flow (broken)

1. User sends "what's on my calendar" in Teams
2. Gateway resolves user email from AAD Object ID (e.g. `joshual@sonance.com`)
3. Gateway calls `BridgeTokenManager.getKeyForUser("joshual@sonance.com")`:
   - `POST /api/v1/auth/token-exchange`
   - Headers: `X-API-Key: ctx_12e4abb9_...` (service key)
   - Body: `{"email": "joshual@sonance.com"}`
   - **Expected**: short-lived per-user API key (`cto_...`)
   - **Actual**: ??? ← **We need Cortex team to confirm this endpoint exists and works**
4. Gateway calls `POST /mcp/cortex` with the per-user API key:
   - Headers: `X-API-Key: <per-user-key>`
   - Body: `{"method": "tools/call", "params": {"name": "m365__list_events", "arguments": {...}}}`
5. Cortex calls `resolve_mcp_token(user_id, "m365")` → gets user's OAuth token → calls M365 API

---

## 3. Current Problem — Two Distinct Issues

### Issue A: Tools disappear at agent run time (gateway-side bug, being fixed)

The OpenClaw plugin system re-loads the `sonance-cortex` plugin when the config
file changes, which causes tool name conflicts. The bridge tools (`cortex_m365__*`)
are registered at startup but disappear after re-load, making the agent think
M365 isn't connected.

**This is a gateway-side issue we're actively fixing.** But even once tools are
visible to the agent, the execution flow needs Cortex-side answers (Issue B).

### Issue B: Per-user token exchange and MCP bridge auth (need Cortex answers)

We need to confirm the exact contract for per-user tool execution via the MCP
bridge. Specifically:

---

## 4. Questions and Answers from Cortex Team

### Q1: Does `/api/v1/auth/token-exchange` exist on the hosted Cortex?

**YES — confirmed and tested.**

- **Endpoint**: `POST /api/v1/auth/token-exchange` (route: `core/cortex/praxis/api/routes/token_exchange.py`)
- **Auth**: Service key (`ctx_`) must have `service:token_exchange` scope
- **Response format** (verified via curl):
  ```json
  {
    "api_key": "ctx_fa07e7ba_...",
    "user_id": "e5ac1824-42e1-4991-a485-1148139213fb",
    "email": "joshual@sonance.com",
    "expires_in": 14400
  }
  ```
- The returned `ctx_` key is tied to the user's `auth_user_id` (Supabase `auth.users.id`)
- TTL is 4 hours (14400s), not 1 hour
- Scopes include `mcp:list`, `mcp:execute`, `mcp:tools` — sufficient for the MCP bridge

### Q2: How does the MCP bridge resolve user identity?

**From the API key — no extra headers needed.**

- The bridge calls `get_current_user` which resolves the API key → `user_id`
- `ctx["user_id"] = user.id` (line 155 of `mcp_protocol.py`) → passed to `resolve_mcp_token()`
- `X-Cortex-User-Id` delegation does NOT exist on current `main` branch
- Token exchange is the correct and only supported approach

### Q3: M365 connections for test users

- `user_id` in `mcp_connections` is a **UUID** (`auth.users.id`), not email
- After the cross-user token overwrite bug, connections may be stored under the
  service key's owner ID — users likely need to **re-authenticate M365** under
  their own per-user key
- Josh's user_id: `e5ac1824-42e1-4991-a485-1148139213fb` (from token exchange)
- **Verified working**: `m365__list_events` returns real calendar data via per-user key

### Q4: API key types

| Key prefix | Type               | Created by                                  | Lifetime            | Can call `/mcp/cortex`?        | Resolves user OAuth?           |
| ---------- | ------------------ | ------------------------------------------- | ------------------- | ------------------------------ | ------------------------------ |
| `ctx_`     | API Key            | REST API / token exchange / AD provisioning | 4h (token exchange) | Yes (with `mcp:execute` scope) | Yes — via `user_id` on the key |
| `cto_`     | OAuth Access Token | OAuth2 authorization code flow              | ~1 hour             | Yes (with `mcp:execute` scope) | Yes — same mechanism           |

**Using the service key directly on the bridge resolves OAuth for the service key's
owner — not the end user. This is the cross-user bug.**

### Q5: Working curl example (VERIFIED)

```bash
# Step 1: Get per-user key
curl -s -X POST https://cortex-bice.vercel.app/api/v1/auth/token-exchange \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ctx_12e4abb9_5dbc41d18bb9f28044a66ecd7a1c066b23e4abf5964a1d860d2b801a33f2f8d8" \
  -d '{"email": "joshual@sonance.com"}'

# Step 2: Call M365 tool with per-user key
curl -s -X POST https://cortex-bice.vercel.app/mcp/cortex \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api_key_from_step_1>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"m365__list_events","arguments":{"max_results":5}}}'
```

**Result**: Returns real calendar events (Electronics Engineering Weekly,
Cortex weekly sync, etc.). Full pipeline verified end-to-end.

### Q6: Alternative auth paths

| Option                           | Supported?             | Notes                                       |
| -------------------------------- | ---------------------- | ------------------------------------------- |
| A: `X-Cortex-User-Id` delegation | No                     | Not on `main` branch                        |
| B: Email in JSON-RPC params      | No                     | Bridge doesn't accept identity in params    |
| C: Direct OAuth pass-through     | Not recommended        | Bridge doesn't support this path            |
| D: Chat API (`/api/v1/chat/`)    | Yes, different pattern | Cortex controls conversation — different UX |

**Token exchange is the correct and recommended path.** This is exactly what
`BridgeTokenManager` implements.

---

## 5. Critical Security Concern Already Identified

We discovered that when **all requests use the same service API key** (`ctx_...`)
without user differentiation, the MCP bridge's `resolve_mcp_token()` resolves
tokens for whichever user was **last** to authenticate. This caused:

> **User A's M365 OAuth tokens were used for User B's requests**, giving User B
> full access to User A's email, calendar, and files.

This is why per-user API keys (via token exchange) or explicit user-id headers
are essential. The service key alone is NOT safe for multi-user M365 access.

---

## 6. Verified Status (as of 2026-03-06)

| Component                                     | Status     | Notes                                                  |
| --------------------------------------------- | ---------- | ------------------------------------------------------ |
| Apollo proxy (`/v1/messages`)                 | ✅ Working | LLM calls route through Cortex successfully            |
| Tool discovery (`/mcp/cortex` → `tools/list`) | ✅ Working | Returns 39 M365 tools (275 total)                      |
| Cortex API reachability                       | ✅ Working | `https://cortex-bice.vercel.app` responds              |
| MS Teams → Gateway                            | ✅ Working | Messages arrive, user email resolved from AAD          |
| User email propagation                        | ✅ Working | `senderEmail` flows through to plugin tool execution   |
| Token exchange endpoint                       | ✅ Working | Returns per-user `ctx_` key with 4h TTL                |
| Per-user tool execution (curl)                | ✅ Working | `m365__list_events` returns real calendar data         |
| `cortex-tools` plugin disabled                | ✅ Fixed   | Disabled in `sonance-defaults.ts` to prevent conflicts |
| Tool registration conflicts                   | ✅ Fixed   | Bridge tools survive plugin re-loads                   |
| End-to-end via Teams                          | 🧪 Testing | Gateway restarted, awaiting user test                  |

---

## 7. Gateway-Side Code Ready (Pending Cortex Answers)

Our `BridgeTokenManager` in `extensions/sonance-cortex/index.ts` is implemented
and ready. For each tool call, it:

1. Gets `senderEmail` from the MS Teams message context (AAD → Graph API → UPN)
2. Calls token exchange: `POST /api/v1/auth/token-exchange` with service key + email
3. Caches the per-user key (with expiry buffer)
4. Passes the per-user key as `X-API-Key` on the MCP bridge `tools/call` request

Once the Cortex team confirms the contract (Q1-Q6), we can test end-to-end.

---

## 8. What Was Fixed (Gateway Side)

### Fix 1: Disabled `cortex-tools` plugin

**File**: `src/config/sonance-defaults.ts`

The `cortex-tools` plugin registered M365 tools via the HERMES endpoint (no
per-user OAuth). It was auto-enabled by `applySonanceDefaults` and caused tool
name conflicts with `sonance-cortex` bridge tools. Now unconditionally disabled.

### Fix 2: Idempotent bridge tool registration

**File**: `extensions/sonance-cortex/index.ts`

Added `globalThis`-backed guard set (`__sonanceCortexRegisteredTools`) so bridge
tools survive plugin re-loads triggered by the config file watcher.

### Fix 3: Per-user token exchange in tool execution

**File**: `extensions/sonance-cortex/index.ts` (`BridgeTokenManager`)

Each MCP bridge `tools/call` request now:

1. Gets `senderEmail` from MS Teams context (AAD → Graph API → UPN)
2. Exchanges service key + email → per-user `ctx_` key (4h TTL, cached)
3. Uses per-user key as `X-API-Key` on the bridge request
4. Cortex resolves `user_id` from the key → `resolve_mcp_token()` → correct OAuth tokens
