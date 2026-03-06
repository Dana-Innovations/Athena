# Cortex M365 Authentication — Root Cause & Fix

## TL;DR

**Root cause**: Two plugins (`cortex-tools` and `sonance-cortex`) both registered
M365 tools with name `cortex_m365__*`. The `cortex-tools` plugin registered first
(synchronous) and its `execute` function called Cortex's HERMES REST endpoint
(`POST /api/v1/tools/{mcp}/{tool}`) — which does **not** call `resolve_mcp_token()`
and therefore cannot look up per-user OAuth tokens. The `sonance-cortex` bridge
tools (which correctly route through `/mcp/cortex`) were shadowed.

**Fix applied**: Changed `cortex-tools/src/client.ts` `callTool()` to route
tool execution through the MCP bridge (`POST /mcp/cortex` with JSON-RPC) instead
of the HERMES REST endpoint. The bridge calls `resolve_mcp_token()` and correctly
resolves per-user M365 OAuth tokens.

---

## Questions & Answers from Cortex Team

### Q1: Does Apollo intercept and execute tool_use blocks server-side?

**Answer: (a) — Apollo streams tool_use blocks back to the client. No interception.**

Apollo is a pass-through proxy to Anthropic. The `/v1/messages` endpoint forwards
the request to Anthropic and returns the response as-is, including any `tool_use`
blocks. There is no tool loop, no tool execution, and no interception.

The gateway IS receiving the `tool_use` blocks. The problem was what the gateway
did with them: the `cortex-tools` plugin routed execution to `/api/v1/tools/`
instead of `/mcp/cortex`.

Note: Cortex does have a server-side tool loop, but it lives in the Chat API at
`/api/v1/chat/*` — a completely separate flow from Apollo.

### Q2: Why does `/api/v1/tools/m365/get_profile` return AUTH_REQUIRED?

**Root cause: The tools endpoint does NOT call `resolve_mcp_token()`.**

The HERMES endpoint at `/api/v1/tools/` only uses the `access_token` from the
JSON request body. If the client doesn't send one (or sends a Cortex `ctx_`/`cto_`
token which gets stripped), the access_token is `None`. For M365 there's no
company-default PAT, so the MCP's `authenticate()` check fails.

By contrast, the MCP bridge at `/mcp/cortex` calls `resolve_mcp_token(user_id,
mcp_name)` which queries the `mcp_connections` table for the user's stored,
encrypted OAuth token.

| Aspect                     | `/api/v1/tools/`                               | `/mcp/cortex`                               |
| -------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Calls `resolve_mcp_token`? | No                                             | Yes                                         |
| Token source               | `request.access_token` in JSON body only       | `mcp_connections` DB table (personal OAuth) |
| Company fallback           | Yes (env vars like `CORTEX_GITHUB_PAT`)        | Yes (same fallback)                         |
| OAuth-only MCPs (M365)     | Always AUTH_REQUIRED unless token sent in body | Works — resolves stored OAuth token         |

### Q3: How does Apollo resolve user identity for internal tool execution?

Apollo doesn't execute tools, so this doesn't apply. Each endpoint resolves
identity independently:

- **`/v1/messages` (Apollo)**: API key auth for rate limiting/usage only
- **`/api/v1/tools/` (HERMES)**: API key auth, user_id set on context but never
  used for OAuth lookup
- **`/mcp/cortex` (bridge)**: API key auth + `X-Cortex-User-Id` delegation +
  `resolve_mcp_token()` for per-user OAuth

### Q4: Can Apollo's tool interception be disabled?

Nothing to disable — Apollo already returns `tool_use` blocks without executing
them. The gateway receives the blocks and decides how to execute.

### Q5: Can HERMES be made to resolve OAuth tokens like the bridge does?

Yes. The Cortex team confirmed this is a straightforward fix: add
`resolve_mcp_token()` to the `/api/v1/tools/` endpoint. This would make both
execution paths consistent.

### Q6: What is the intended integration pattern?

1. Use **Apollo** (`/v1/messages`) as the LLM proxy — correct and working
2. Use the **MCP bridge** (`/mcp/cortex`) for tool execution — this is the
   endpoint designed for external consumers with full OAuth resolution

---

## What Was Fixed (Gateway Side)

**File**: `extensions/cortex-tools/src/client.ts`

**Before**: `CortexClient.callTool()` constructed a URL like
`POST /api/v1/tools/m365/get_profile` (HERMES REST, no OAuth).

**After**: `CortexClient.callTool()` sends a JSON-RPC `tools/call` request to
`POST /mcp/cortex` (MCP bridge, has OAuth resolution).

## Recommended Cortex-Side Fix

Add `resolve_mcp_token()` to the HERMES `/api/v1/tools/` endpoint so both
execution paths work consistently, regardless of which one clients use.
