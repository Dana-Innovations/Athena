# Cortex Sync: Apollo Usage Logging Not Persisting

**From:** Athena (OpenClaw fork)
**To:** Cortex team
**Date:** 2026-02-19
**Status:** Resolved — see [apollo-usage-logging-response.md](./apollo-usage-logging-response.md)

---

## Summary

The Apollo proxy at `http://localhost:8000` successfully proxies `/v1/messages`
requests to Anthropic and returns responses enriched with `cortexUsage`
metadata. However, **none of these requests are persisted to the usage
database**. The `/api/v1/ai/usage` and `/api/v1/ai/usage/logs` endpoints
never reflect requests made through the SDK-compat proxy.

This means the Apollo Usage tab in the Athena gateway UI always shows stale
data (51 historical requests from earlier today), despite active chat usage
flowing through Apollo successfully.

---

## Reproduction

### Step 1: Confirm the proxy works

```bash
curl -s http://localhost:8000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: ctx_565b042f_cd0c45ae7de4a68404597913c34c2dce2b2d8be818f56a57defb3bb5d2a1a777" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 10,
    "messages": [{"role":"user","content":"Say hi"}]
  }' | python3 -m json.tool
```

**Result:** 200 OK with a valid Anthropic response + `cortexUsage`:

```json
{
  "id": "msg_01RfSLcuUFUrApKC6FKoqd6d",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi! How can I help" }],
  "model": "claude-sonnet-4-5-20250929",
  "usage": {
    "inputTokens": 9,
    "outputTokens": 10
  },
  "cortexUsage": {
    "requestId": "req_06022b18247e41469da373be77a4f85b",
    "inputTokens": 9,
    "outputTokens": 10,
    "totalTokens": 19,
    "costUsd": 0.000177,
    "latencyMs": 2035,
    "keySource": "org"
  }
}
```

The proxy works. Anthropic responds. `cortexUsage` is computed and returned.

### Step 2: Check usage — request is missing

```bash
# Immediately after the request above:
curl -s http://localhost:8000/api/v1/ai/usage \
  -H "X-API-Key: ctx_565b042f_..." \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('totalRequests:', d['summary']['totalRequests'])"
```

**Result:** `totalRequests: 51` — unchanged. The request from Step 1 is not
counted.

```bash
curl -s http://localhost:8000/api/v1/ai/usage/logs?limit=2 \
  -H "X-API-Key: ctx_565b042f_..." \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for l in d.get('logs',[]):
    print(l['createdAt'], l['requestId'])
"
```

**Result:**

```
2026-02-19T18:43:15.752873Z  req_5bb2ff08201f449d820ee240840627e3
2026-02-19T18:40:50.620129Z  req_ac4596045fac456c9fa4299b30d5f0b2
```

The latest log entry is from 18:43 — over 2.5 hours before our test. The
`req_06022b18...` from Step 1 never appears.

---

## Analysis

### What IS being logged (the 51 historical requests)

All 51 existing log entries share these metadata traits:

```json
{
  "metadata": {
    "source": "direct_api",
    "consumer_id": "athena-mcp-bridge",
    "client_identifier": "cortex-backend/1.0"
  },
  "sourceType": "direct_api"
}
```

These were logged by a **different code path** — likely the internal Cortex
backend making direct API calls (e.g., for MCP tool execution), not through
the SDK-compat proxy (`/v1/messages`).

### What is NOT being logged (new proxy requests)

Requests sent through `POST /v1/messages` (the SDK-compat endpoint from
`sdk_compat.py`) are proxied successfully to Anthropic, and `cortexUsage` is
computed and returned in the response body. But the usage record is **never
written to the `ai_usage_logs` table** in Supabase.

### Likely cause

The SDK-compat router in `sdk_compat.py` re-mounts the `create_message`
handler from `ai.py`. The usage logging likely happens in one of two places:

1. **In-process:** After the Anthropic response is received, a usage record
   is inserted into Supabase. If the SDK-compat route skips this step (or the
   insert fails silently), no log is written.

2. **Async/background:** A background task or queue writes usage records. If
   this worker is not running or is failing, records are lost.

The `cortexUsage` metadata in the response proves the **cost computation
works** — the issue is specifically in the **persistence step**.

---

## Questions for Cortex Team

### Q1: Where does usage logging happen?

Which function/method writes to `ai_usage_logs` in Supabase? Is it:

- A) Inline in the request handler (after the Anthropic call returns)?
- B) A background task (`BackgroundTasks` in FastAPI)?
- C) An async worker/queue?

### Q2: Does the SDK-compat route share the same logging path?

The `sdk_compat.py` router re-mounts the AI service handler. Does it also
include the usage logging middleware/dependency? Or is usage logging applied
only to the `/api/v1/ai/messages` route and not to `/v1/messages`?

### Q3: Is there a separate usage logging service?

The existing 51 records have `client_identifier: "cortex-backend/1.0"` and
`source: "direct_api"`. Are these written by a different mechanism (e.g., a
middleware that only wraps internal API calls)?

### Q4: Are there any errors in the Cortex server logs?

After sending a request to `/v1/messages`, are there any errors related to:

- Supabase insert failures
- Missing database columns/tables
- Permission denied on `ai_usage_logs` table
- Background task exceptions

**Request:** Check the Cortex server terminal output (or log file) for errors
that occur around the time of a `/v1/messages` request.

### Q5: Is `consumer_id` / metadata passthrough required for logging?

The existing logs all include `consumer_id: "athena-mcp-bridge"` in metadata.
When Athena sends requests through the Anthropic SDK (via `x-api-key`), it
does NOT set `cortex_metadata` on the request body. Could the logging
pipeline be conditional on the presence of metadata fields?

---

## Requested Changes

### Change 1: Ensure `/v1/messages` requests are logged (Blocker)

The SDK-compat endpoint (`POST /v1/messages`) must write a usage record to
`ai_usage_logs` for every successful Anthropic response. This is the primary
entry point for all Athena AI traffic.

**Acceptance criteria:**

1. Send a request to `POST /v1/messages` with a valid `x-api-key`
2. Receive a 200 response with `cortexUsage`
3. Within 5 seconds, `GET /api/v1/ai/usage/logs?limit=1` returns the new
   request with matching `requestId`
4. `GET /api/v1/ai/usage` summary `totalRequests` is incremented

### Change 2: Include `source` metadata for proxy requests

When a request comes through `/v1/messages` (SDK-compat), the usage log
should include metadata distinguishing it from internal API calls:

```json
{
  "metadata": {
    "source": "sdk_compat",
    "consumer_id": "<from x-cortex-consumer-id header, if present>",
    "client_identifier": "<from User-Agent header>"
  },
  "sourceType": "sdk_compat"
}
```

This lets the usage dashboard differentiate between:

- Athena gateway AI traffic (via `/v1/messages`)
- Internal Cortex MCP bridge traffic (via direct API)
- Other consumers

### Change 3 (Nice to have): Streaming usage logging

For streaming requests (`stream: true` on `/v1/messages`), usage should also
be logged after the stream completes. The `cortexUsage` is already computed
for the final SSE event — the same data should be persisted.

---

## Cortex-Side 404 on Tool Loading

### Symptom

During gateway startup, the direct tool-loading path produces:

```
[sonance-cortex] failed to load tools: Error: Cortex API error: 404 Not Found — {"detail":"Not Found"}
```

This occurs before the CompositeMCPBridge tools load (which works fine). The
404 comes from a `GET /api/v1/mcp/tools` or similar endpoint that the
`CortexClient.getTools()` method calls.

### Question

- What is the correct endpoint for listing all available MCP tools directly
  (not via the CompositeMCPBridge JSON-RPC)?
- Is this endpoint deprecated in favor of the `/mcp/cortex` bridge?
- If deprecated, we can remove the direct tool-loading path from Athena.

---

## Athena-Side Changes Completed

For reference, the following changes were made on the Athena side during this
integration session. No Cortex changes are needed for these:

| Change                 | File                                         | Description                                                                                                            |
| ---------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Apollo baseUrl routing | `src/config/sonance-defaults.ts`             | Sets `models.providers.anthropic.baseUrl` to `apolloBaseUrl` so all Anthropic SDK calls route through the Apollo proxy |
| Central key resolver   | `extensions/sonance-cortex/index.ts`         | Returns the Cortex API key (`ctx_...`) as the Anthropic credential when `apolloBaseUrl` is configured                  |
| MCP bridge auth fix    | `extensions/sonance-cortex/index.ts`         | Changed CompositeMCPBridge auth from `Authorization: Bearer` to `X-API-Key` header to match Cortex Aegis expectations  |
| Agent sync loop fix    | `extensions/sonance-cortex/index.ts`         | Prevents infinite restart loop by comparing tool lists before writing to config                                        |
| Apollo usage polling   | `ui/src/ui/app-polling.ts`                   | Added 30-second auto-refresh for Apollo usage data in the UI                                                           |
| TypeScript build fixes | `src/gateway/auth.ts`, `src/gateway/call.ts` | Fixed TS errors that prevented full gateway build                                                                      |

---

## Verification After Cortex Fix

Once usage logging is fixed for `/v1/messages`, run this end-to-end test:

```bash
# 1. Note current count
BEFORE=$(curl -s http://localhost:8000/api/v1/ai/usage \
  -H "X-API-Key: ctx_565b042f_..." \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['totalRequests'])")
echo "Before: $BEFORE"

# 2. Send a test message through the SDK-compat proxy
curl -s http://localhost:8000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: ctx_565b042f_..." \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 10,
    "messages": [{"role":"user","content":"Test usage logging"}]
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('requestId:', d.get('cortexUsage',{}).get('requestId','MISSING'))"

# 3. Wait a moment, then check count
sleep 3
AFTER=$(curl -s http://localhost:8000/api/v1/ai/usage \
  -H "X-API-Key: ctx_565b042f_..." \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['totalRequests'])")
echo "After: $AFTER"

# 4. Verify
if [ "$AFTER" -gt "$BEFORE" ]; then
  echo "PASS: Usage count incremented ($BEFORE -> $AFTER)"
else
  echo "FAIL: Usage count unchanged ($BEFORE -> $AFTER)"
fi
```

---

## Priority

| Item                               | Severity                | Owner  |
| ---------------------------------- | ----------------------- | ------ |
| `/v1/messages` usage not logged    | **Blocker**             | Cortex |
| Source metadata for proxy requests | Medium                  | Cortex |
| Streaming usage logging            | Nice to have            | Cortex |
| Direct tool-loading 404            | Low (workaround exists) | Both   |
