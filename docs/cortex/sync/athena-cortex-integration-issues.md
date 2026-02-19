# Cortex Sync: Integration Issues and Questions

**From:** Athena (OpenClaw fork)
**To:** Cortex team
**Date:** 2026-02-19
**Status:** Open — awaiting answers

---

## Context

Athena (our OpenClaw fork) has completed the full integration with Cortex
Phase 0+1 (CompositeMCPBridge) and Phase 2 (Apollo Multi-Auth). The code
builds cleanly, the gateway starts, and the M365 MCP loads 52 tools. However,
we cannot end-to-end test because:

1. The Cortex server on `:8000` is unresponsive (socket CLOSED)
2. The existing API key is missing scopes needed by new features
3. Two headers Athena relies on (`x-cortex-user-id`, `x-cortex-key-source`)
   do not exist in Cortex yet

This document lists every issue, ordered by severity.

---

## Issue 1: Cortex Server Socket Closed (Blocker)

**Symptom:** The uvicorn process (PID 8087) is alive, but the TCP socket on
port 8000 is in `CLOSED` state. All HTTP requests time out. `SYN_SENT`
connections pile up.

```
$ lsof -i :8000 -P -n
Python  8087  sonanceguest  3u  IPv4 ...  TCP *:8000 (CLOSED)

$ netstat -an | grep 8000
tcp4  0  0  *.8000  *.*  CLOSED
```

**Startup command was:**

```bash
uvicorn cortex.main:app --host 0.0.0.0 --port 8000 --reload
```

**Likely cause:** Hot-reload crashed (import error, missing dependency, or
Python exception during module reload). The process stays alive but the socket
is dead.

**Request:**

- [ ] Restart the Cortex server: kill PID 8087, then re-run uvicorn
- [ ] Check the Cortex terminal for traceback/error output
- [ ] If it crashes again, share the traceback so we can investigate together

---

## Issue 2: API Key Missing Scopes (Blocker)

The current API key (`ctx_565b042f_...`) was created with:

```json
["ai:messages", "ai:messages:stream", "ai:models"]
```

New features require additional scopes:

| Feature                                 | Required Scope               | Used By                    |
| --------------------------------------- | ---------------------------- | -------------------------- |
| CompositeMCPBridge (`POST /mcp/cortex`) | `mcp:execute` or `mcp:tools` | Tool discovery + execution |
| Key management (`/api/v1/ai/keys/*`)    | `ai:settings`                | User key CRUD, OAuth       |
| Usage dashboard (`/api/v1/ai/usage`)    | `ai:usage`                   | Apollo Usage tab           |
| Usage logs (`/api/v1/ai/usage/logs`)    | `ai:usage:logs`              | Recent requests table      |

**Request:**

- [ ] Update the existing API key in Supabase `api_keys` table to include all
      required scopes:

```sql
UPDATE api_keys
SET scopes = '["ai:messages", "ai:messages:stream", "ai:models", "ai:usage", "ai:usage:logs", "ai:settings", "mcp:execute", "mcp:tools"]'
WHERE key_prefix = '565b042f';
```

Or create a new key with all scopes and share it securely.

---

## Issue 3: `x-cortex-user-id` Header Not Read (Design Gap)

Athena sends an `x-cortex-user-id` header on Apollo-bound requests so that
Apollo can resolve per-user Anthropic keys (Phase 2 Multi-Auth). However,
**Cortex does not read this header**. User identity is resolved entirely from
the API key via Aegis authentication.

This means Multi-Auth key resolution (`user_key > user_oauth > org`) cannot
work when Athena uses a single shared `ctx_...` API key — all requests
resolve to the same `user_id` regardless of which Athena user initiated the
request.

**Options:**

| Option                 | Description                                                                                                                                                                        | Effort                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| A — Header passthrough | Cortex reads `x-cortex-user-id` from trusted consumers (when API key has a specific scope like `ai:impersonate`) and uses it for key resolution instead of the API key's `user_id` | Medium (Cortex PR)             |
| B — Per-user API keys  | Each Athena user gets their own `ctx_...` key. User identity comes from the key itself. No Cortex change needed.                                                                   | None (Cortex), Medium (Athena) |
| C — JWT auth           | Athena authenticates to Cortex with per-user JWTs instead of a shared API key. Cortex already supports JWT auth.                                                                   | Medium (Athena)                |

**Question:** Which approach does the Cortex team prefer? Option A is the
cleanest for multi-user gateways. Option B works today but requires key
provisioning per user.

For the PoC with a single developer, this is non-blocking — the shared key's
`user_id` is used for everything.

---

## Issue 4: `x-cortex-key-source` Response Header Not Sent (Design Gap)

Athena's `apollo-compat.ts` fetch interceptor reads
`response.headers.get("x-cortex-key-source")` to capture which key source
(org, user_key, user_oauth) was used for each AI request. This is stored in
audit events for billing/security tracking.

**Finding:** Cortex does NOT send this as a response header. The `key_source`
is only available inside the `cortex_usage` field in the response body:

```json
{
  "cortex_usage": {
    "keySource": "org",
    "totalTokens": 150,
    "costUsd": 0.0045
  }
}
```

**Options:**

| Option                  | Description                                                                                             | Effort                |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| A — Add response header | Cortex adds `x-cortex-key-source: org` header to all `/v1/messages` and `/api/v1/ai/messages` responses | Small (Cortex PR)     |
| B — Parse response body | Athena extracts `keySource` from the `cortex_usage` JSON in the response body instead of a header       | Small (Athena change) |

**Recommendation:** Option B is self-contained (we can do it ourselves). But
Option A is cleaner because:

- Headers are available before the full body is parsed
- Streaming responses send `cortex_usage` as the final SSE event, so Athena
  would need to buffer/parse SSE to extract it
- A header is available immediately on the response object

**Question:** Would the Cortex team be open to adding the
`x-cortex-key-source` response header? We can submit a PR if preferred.

---

## Issue 5: Missing `CORTEX_ENCRYPTION_KEY` in `.env`

The key management endpoints (`/api/v1/ai/keys/*`) call
`_get_encryption()` which requires `settings.encryption_key` (env var
`CORTEX_ENCRYPTION_KEY`). This is not set in the current `core/.env`.

Without it, all key management endpoints return 500:
"Encryption key not configured"

**Request:**

- [ ] Generate a Fernet key and add it to `.env`:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Then add to `core/.env`:

```bash
CORTEX_ENCRYPTION_KEY=<generated-key>
```

---

## Issue 6: Usage Endpoint Path Mismatch (Minor)

Athena's `cortex-client.ts` calls `GET /api/v1/ai/usage` to fetch usage data
for the Apollo dashboard tab. This endpoint exists in Cortex and returns
`AIUsageResponse`.

**However**, Athena also calls a non-existent `/api/v1/ai/usage/summary`
endpoint in the `sonance.apollo.usage` gateway method. We need to confirm the
exact response shape.

**Questions:**

- [ ] Does `GET /api/v1/ai/usage` return data matching this shape?

```typescript
{
  summary: {
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
  }
  data: Array<{
    date?: string;
    model?: string;
    requests: number;
    tokens: number;
    costUsd: number;
  }>;
  limits: {
    monthlySpendLimitCents: number;
    monthlySpendUsedCents: number;
    dailyTokenLimit: number;
    dailyTokensUsed: number;
  }
}
```

- [ ] Does it accept `?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&group_by=day`
      query params? (Confirmed from code — yes)

- [ ] Does it require `ai:usage` scope? (Confirmed from code — yes)

---

## Issue 7: CompositeMCPBridge Feature Flag

The MCP protocol endpoints check `settings.feature_mcps_enabled`. This
defaults to `True` in settings.py, but:

**Question:**

- [ ] Is `CORTEX_FEATURE_MCPS_ENABLED` explicitly set in the environment? If
      it's set to `false` or `0`, the bridge will return 503.
- [ ] Which MCPs are enabled? (`CORTEX_MCPS_ENABLED` list). If empty, the
      composite bridge may return zero tools.
- [ ] Are there GitHub/Supabase/Vercel MCPs configured and enabled?

---

## Issue 8: Apollo SDK Compat Endpoint Path

Athena's Anthropic SDK sends requests to `POST /v1/messages` (via the
`sdk_compat.py` router). The `apollo-compat.ts` interceptor rewrites the
`system` field from an array to a string.

**Questions:**

- [ ] Is the `system` field flattening still needed? (We flatten
      `[{type:"text", text:"..."}]` to a plain string.) Does Cortex/Apollo
      handle array-format `system` natively now?
- [ ] Does streaming (`stream: true`) work through the SDK compat endpoint?
      (Confirmed from code — yes, same handler.)

---

## Summary: Priority Order

| #   | Issue                           | Severity                   | Owner  | Action                               |
| --- | ------------------------------- | -------------------------- | ------ | ------------------------------------ |
| 1   | Server socket CLOSED            | **Blocker**                | Cortex | Restart uvicorn, share any traceback |
| 2   | API key missing scopes          | **Blocker**                | Cortex | Update scopes in Supabase            |
| 5   | Missing encryption key          | **Blocker** (for key mgmt) | Cortex | Add `CORTEX_ENCRYPTION_KEY` to .env  |
| 3   | `x-cortex-user-id` not read     | Design gap                 | Both   | Decide approach (A/B/C)              |
| 4   | `x-cortex-key-source` header    | Design gap                 | Both   | Decide approach (A/B)                |
| 7   | MCP feature flag / enabled MCPs | Question                   | Cortex | Confirm config                       |
| 6   | Usage endpoint shape            | Question                   | Cortex | Confirm response format              |
| 8   | System field / streaming        | Question                   | Cortex | Confirm current behavior             |

**Once issues 1, 2, and 5 are resolved, we can immediately test:**

- CompositeMCPBridge tool discovery (GitHub, Supabase, Vercel tools)
- Apollo proxy (AI message routing through Cortex)
- Usage dashboard (Apollo Usage tab in gateway UI)
- Key management (set/verify/remove user Anthropic keys)

---

## Quick Verification After Fixes

```bash
# 1. Health check
curl -s http://localhost:8000/health | python3 -m json.tool

# 2. MCP bridge — list tools
curl -s -X POST http://localhost:8000/mcp/cortex \
  -H "Content-Type: application/json" \
  -H "x-api-key: ctx_565b042f_..." \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | python3 -m json.tool

# 3. Apollo — send a test message
curl -s http://localhost:8000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: ctx_565b042f_..." \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 50,
    "messages": [{"role":"user","content":"Say hello"}]
  }' | python3 -m json.tool

# 4. Usage data
curl -s http://localhost:8000/api/v1/ai/usage \
  -H "x-api-key: ctx_565b042f_..." | python3 -m json.tool

# 5. Key status
curl -s http://localhost:8000/api/v1/ai/keys/status \
  -H "x-api-key: ctx_565b042f_..." | python3 -m json.tool
```
