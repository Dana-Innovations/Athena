# Cortex Sync: Apollo Usage Logging — Response

**From:** Cortex team
**To:** Athena (OpenClaw fork)
**Date:** 2026-02-19
**Status:** Resolved — all changes verified

---

## Root Cause

**`SupabaseApolloProvider.insert_usage_log()` missing `key_source` parameter.**

The `key_source` parameter was added to:

- `UsageLogEntry` dataclass
- `StorageProvider` protocol in `tracker.py`
- `_create_usage_log_entry()` in `service.py`

But **NOT** to `SupabaseApolloProvider.insert_usage_log()` in
`chronos/apollo_provider.py`. This caused every call to
`UsageTracker.log_request()` to fail with:

```
TypeError: SupabaseApolloProvider.insert_usage_log() got an unexpected keyword argument 'key_source'
```

This was caught by the `fail_silently=True` error handler, so it appeared as
a benign warning in logs — but it **silently broke all usage logging** (both
streaming and non-streaming, on all endpoints).

---

## Answers to Questions

### Q1: Where does usage logging happen?

**A) Inline in the request handler**, after the Anthropic call returns.
`service.create_message()` calls
`await self._usage_tracker.log_request(log_entry)` at line 1100. It's
awaited (not fire-and-forget) to ensure persistence on serverless platforms.

### Q2: Does the SDK-compat route share the same logging path?

**Yes.** `sdk_compat.py` re-mounts the exact same `create_message` handler
via `router.add_api_route()`. All DI, auth, and logging run identically. The
bug affected all routes equally — the 51 historical records were from before
the `key_source` code was added.

### Q3: Is there a separate usage logging service?

**No.** The 51 records with `client_identifier: "cortex-backend/1.0"` were
logged by the same code path, just before the `key_source` parameter was
introduced.

### Q4: Errors in server logs?

**Yes.** Visible at `ERROR` level:

```
ERROR [cortex.apollo.usage.tracker] Failed to log usage: request_id=req_...,
  error=SupabaseApolloProvider.insert_usage_log() got an unexpected keyword argument 'key_source'
```

### Q5: Is metadata passthrough required?

**No.** Logging is unconditional. The `cortex_metadata` field is optional and
only affects enrichment.

---

## Changes Made

### Change 1: Fixed usage logging for ALL endpoints (Blocker)

Added the missing `key_source` parameter to
`SupabaseApolloProvider.insert_usage_log()` and included it in the insert
data dict. Added a resilient retry that strips `key_source` if the DB column
doesn't exist (it does, but safety first).

`apollo_provider.py` lines 114-158:

```python
log_id = str(uuid4())
data: dict[str, Any] = {
    # ... all fields ...
    "key_source": key_source,
}

try:
    await self._client.table("ai_usage_logs").insert(data).execute()
except Exception as e:
    err_msg = str(e)
    if "key_source" in err_msg:
        logger.warning(
            "key_source column missing in ai_usage_logs, retrying without it"
        )
        data.pop("key_source", None)
        await self._client.table("ai_usage_logs").insert(data).execute()
    else:
        raise
```

**Verified:** Sent test request to `/v1/messages`, confirmed 201 Created in
Supabase, usage count went from 51 to 52.

### Change 2: SDK-compat source metadata

Requests through `/v1/messages` now get `source_type: "sdk_compat"` instead
of `"direct_api"`. Added detection in the `create_message` handler based on
`http_request.url.path`:

`ai.py` lines 317-319:

```python
# Override source_type for SDK compat endpoint (/v1/messages)
if source_type == "direct_api" and http_request.url.path.startswith("/v1/"):
    source_type = "sdk_compat"
```

Added `SOURCE_TYPE_SDK_COMPAT` constant and mappings in `enrichment.py`. The
auto-project system now creates "SDK Compat" projects for Athena traffic —
confirmed in logs:

```
Auto-created AI project: name=SDK Compat slug=auto-sdk-compat id=c727aef2-...
```

### Change 3: Streaming usage logging — confirmed working

The streaming path had the same `key_source` bug. Now fixed. Test confirmed:
streaming request through `/v1/messages` with `stream: true` produces 201
Created for both `ai_usage_logs` and `activity_events`.

---

## Direct Tool-Loading 404

The correct REST endpoint for listing all MCP tools is:

```
GET /api/v1/tools/schemas
```

This returns all tool schemas across all enabled MCPs. Optionally filter with
`?mcps=github,supabase`.

There is **no** `GET /api/v1/mcp/tools` endpoint — that path doesn't exist.
Athena's `CortexClient.getTools()` should either:

- Use `GET /api/v1/tools/schemas` (REST, returns Claude function calling
  format)
- Use `POST /mcp/cortex` with JSON-RPC `tools/list` (the
  CompositeMCPBridge, which already works)

The `/mcp/cortex` bridge is the recommended approach for tool discovery since
it provides the standard MCP protocol interface.

---

## Verification Results

```
# Non-streaming: 201 Created
POST /v1/messages -> ai_usage_logs insert succeeded
totalRequests: 51 -> 52

# Streaming: 201 Created
POST /v1/messages (stream=true) -> ai_usage_logs insert succeeded
totalRequests: 52 -> 53

# Source type differentiation
SDK compat requests -> source_type: "sdk_compat"
Auto-project: "SDK Compat" (slug: auto-sdk-compat)
```

---

## Action Items for Athena

| Item                               | Description                                                                                                                                                                                           | Priority      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Restart gateway                    | Kill and restart the gateway to pick up the fixed Cortex server. New chat messages should now appear in the Apollo usage dashboard.                                                                   | **Immediate** |
| Fix direct tool-loading path       | Update `CortexClient.getTools()` to call `GET /api/v1/tools/schemas` instead of the non-existent endpoint, or remove the direct path entirely since CompositeMCPBridge (`/mcp/cortex`) already works. | Low           |
| Filter by `source_type` (optional) | The usage dashboard could filter/group by `source_type` to distinguish `sdk_compat` (Athena chat) from `direct_api` (MCP bridge) traffic.                                                             | Nice to have  |
