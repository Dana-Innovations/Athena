# Cortex Sync: Response to All Integration Issues

**From:** Cortex team
**To:** Athena (OpenClaw fork)
**Date:** 2026-02-19
**Status:** Resolved — action items for Athena below

---

## Issue 1: Server Socket CLOSED — FIXED

**Root cause:** The `chat:read` and `chat:write` scopes were defined in
`cortex/aegis/scopes.py` (as `CHAT_SCOPES`) but were never added to
`ALL_SCOPES` on line 249. The `require_scopes()` dependency validates at
import time, so when `chat.py` line 1387 used
`require_scopes(CHAT_SCOPE_READ)`, the module-level `ValueError` prevented
the FastAPI app from loading. The uvicorn reloader process stayed alive but
the worker subprocess crashed — hence the socket in CLOSED state.

**Fix applied:** Added `CHAT_SCOPES` and `TELEGRAM_SCOPES` to the
`ALL_SCOPES` union in `scopes.py`:

```python
# scopes.py lines 249-251
ALL_SCOPES: Final[frozenset[str]] = (
    AI_SCOPES | CHAT_SCOPES | TELEGRAM_SCOPES | MCP_SCOPES | WEBHOOK_SCOPES | ADMIN_SCOPES | AD_SCOPES
)
```

Server is now running and healthy at `http://localhost:8000`.

---

## Issue 2: API Key Missing Scopes — Confirmed Valid

The scopes Athena needs are all valid and defined in Cortex. The full valid
scope list (from the server startup log):

```
ad:admin, ad:view, admin:keys, admin:settings, admin:users, ai:count_tokens,
ai:messages, ai:messages:stream, ai:models, ai:projects, ai:settings,
ai:usage, ai:usage:logs, chat:read, chat:write, mcp:execute, mcp:list,
mcp:tools, telegram:link, webhook:create, webhook:manage
```

The SQL in the sync doc is correct. The required scopes (`ai:usage`,
`ai:usage:logs`, `ai:settings`, `mcp:execute`, `mcp:tools`) are all valid.
**This requires a Supabase `api_keys` table UPDATE.**

---

## Issue 3: `x-cortex-user-id` — Design Recommendation

**Confirmed:** Cortex does NOT read `x-cortex-user-id`. The user identity is
resolved entirely from the API key via `_verify_api_key()` in
`dependencies.py`.

**Recommendation:** Option A (Header passthrough) is the cleanest for the
multi-user gateway use case, but it needs a new scope (e.g.,
`ai:impersonate`) and careful security review. For the PoC with a single
developer, this is **non-blocking** — the shared key's `user_id` works fine.

For longer-term, Option C (JWT auth) is worth considering since Cortex
already supports JWT authentication via Supabase JWT verification.

---

## Issue 4: `x-cortex-key-source` Response Header — IMPLEMENTED (non-streaming)

**Fix applied:** Added the `x-cortex-key-source` header to all non-streaming
`/v1/messages` and `/api/v1/ai/messages` responses. The header is set from
`response.cortexUsage.keySource` after the Anthropic call completes.

```python
# ai.py lines 383-385
if response.cortex_usage and response.cortex_usage.key_source:
    fastapi_response.headers["x-cortex-key-source"] = response.cortex_usage.key_source
```

**Streaming caveat:** For streaming responses, the `key_source` is resolved
inside the service generator and isn't available until the stream starts. The
`keySource` is still available in the final `cortex_usage` SSE event. Adding
the header to streaming responses would require refactoring the key
resolution out of the stream generator — doable but a separate PR.

**Recommendation for Athena:** For non-streaming, read the header. For
streaming, parse `keySource` from the final `cortex_usage` SSE event.

---

## Issue 5: Missing `CORTEX_ENCRYPTION_KEY` — FIXED

Generated a Fernet key and added it to `core/.env`:

```
CORTEX_ENCRYPTION_KEY=RZHThiniNzPBHNkkbAcWf1lfbNRNJFKZt4S9_a43aVM=
```

Key management endpoints (`/api/v1/ai/keys/*`) should now work.

---

## Issue 6: Usage Endpoint Response Shape — Confirmed

`GET /api/v1/ai/usage` returns `AIUsageResponse` with this shape:

```json
{
  "summary": {
    "totalRequests": 0,
    "totalInputTokens": 0,
    "totalOutputTokens": 0,
    "totalCostUsd": 0.0
  },
  "data": [
    {
      "date": "2026-02-19",
      "model": "claude-sonnet-4-5-20250929",
      "projectId": null,
      "requests": 5,
      "inputTokens": 1200,
      "outputTokens": 800,
      "costUsd": 0.015
    }
  ],
  "limits": {
    "monthlyTokenLimit": null,
    "monthlyTokensUsed": 0,
    "monthlySpendLimitUsd": null,
    "monthlySpendUsedUsd": 0.0
  }
}
```

**Differences from Athena's expected shape:**

| Field                           | Athena expects | Cortex returns                                      |
| ------------------------------- | -------------- | --------------------------------------------------- |
| `summary.totalTokens`           | Combined total | `totalInputTokens` + `totalOutputTokens` (separate) |
| `data[].tokens`                 | Combined       | `inputTokens` + `outputTokens` (separate)           |
| `limits.monthlySpendLimitCents` | Cents          | `monthlySpendLimitUsd` (USD float)                  |
| `limits.dailyTokenLimit`        | Present        | Not included in usage response                      |

**Query params confirmed:** `?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&group_by=day`
Also supports `project_id` and `consumer_id` filters. Requires `ai:usage` scope.

**Note:** There is no `/api/v1/ai/usage/summary` endpoint. The usage summary
is part of the `/api/v1/ai/usage` response.

---

## Issue 7: MCP Feature Flag / Enabled MCPs — Confirmed

- `CORTEX_FEATURE_MCPS_ENABLED` defaults to `True`. Not set in `.env`, uses
  default. **MCPs are enabled.**
- `CORTEX_MCPS_ENABLED` defaults to empty list = **all registered MCPs available**
- Currently connected: **GitHub** (8 repos from Dana-Innovations). Vercel
  returns 403 (token expired). Supabase Management API returns 401 (needs
  token refresh).

---

## Issue 8: System Field / Streaming — Confirmed

**System field:** Cortex/Apollo accepts **both** string and array format
natively:

```python
# types.py lines 311-313
system: str | list[dict[str, Any]] | None = Field(
    None, description="System prompt (string or content block array)"
)
```

The value is passed through to Anthropic as-is. **Athena does NOT need to
flatten `[{type:"text", text:"..."}]` to a string.** The array format works
directly.

**Streaming:** Yes, streaming works through the SDK compat endpoint
(`POST /v1/messages` with `stream: true`). The SDK compat router re-mounts
the same `create_message` handler, so all features are preserved.

---

## Summary

| Issue                     | Status          | Action for Athena                                   |
| ------------------------- | --------------- | --------------------------------------------------- |
| 1 — Server crash          | **FIXED**       | None                                                |
| 2 — API key scopes        | Confirmed valid | Run SQL UPDATE on Supabase                          |
| 3 — `x-cortex-user-id`    | Answered        | Non-blocking for PoC; plan Option A/C               |
| 4 — `x-cortex-key-source` | **IMPLEMENTED** | Read header (non-streaming) or SSE body (streaming) |
| 5 — Encryption key        | **FIXED**       | None                                                |
| 6 — Usage shape           | Confirmed       | Fix Athena types to match Cortex response           |
| 7 — MCP feature flag      | Confirmed       | None (MCPs enabled)                                 |
| 8 — System field          | Confirmed       | Remove unnecessary flattening                       |
