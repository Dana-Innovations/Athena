# Cortex Sync: Apollo Integration for OpenClaw Gateway

**From:** Athena (OpenClaw fork)
**To:** Cortex team
**Date:** 2026-02-19
**Status:** Answered — see [apollo-integration-response.md](./apollo-integration-response.md)

> **Single remaining blocker:** Shared dev Supabase credentials + pre-provisioned
> `ctx_...` API key. See [setup guide](../setup-apollo-poc.md) for developer instructions.

---

## Context

We're integrating the Sonance OpenClaw gateway with Cortex Apollo so that all AI model requests from OpenClaw route through Apollo. This gives us centralized billing, rate limiting, usage tracking, and cost analytics — employees never need (or see) an Anthropic API key.

### The flow we've built

```
OpenClaw gateway
  → sends POST /v1/messages to Cortex (SDK-compat endpoint)
  → with x-api-key: ctx_... (Cortex API key)
  → Aegis validates the credential, resolves user identity
  → Apollo enforces rate limits, model access, project grouping
  → Apollo proxies to Anthropic using server-side CORTEX_ANTHROPIC_API_KEY
  → Response enriched with cortex_usage (cost, tokens, request_id)
  → OpenClaw receives response, continues agent loop
```

We've confirmed this architecture matches Cortex's `sdk_compat.py` router and `dependencies.py` auth flow.

### What's done on the OpenClaw side

- Cortex plugin rewrites Anthropic provider `baseUrl` to point at Apollo
- Central key resolver returns the Cortex API key (`ctx_...`) as the auth credential
- OpenClaw's pi-ai library sends it as `x-api-key` header to Apollo's `/v1/messages`
- Fallback to raw `ANTHROPIC_API_KEY` env var for direct-to-Anthropic PoC (no Cortex needed)
- Config: `SONANCE_APOLLO_BASE_URL` + `SONANCE_CORTEX_API_KEY` env vars

---

## What we need from Cortex

### 1. A Cortex API key with AI scopes

We need a `ctx_...` API key that has at minimum these scopes:

- `ai:messages` — non-streaming message creation
- `ai:messages:stream` — SSE streaming (OpenClaw uses streaming by default)
- `ai:models` — list available models (nice to have)

**Questions:**

- How do we create this key? Is there a CLI command, dashboard UI, or direct Supabase insert?
- Should we create one key per developer, or one shared key for the PoC?
- What's the key format? We've seen `ctx_<8-char-prefix>_<secret>` in the code.

### 2. Local Cortex server setup instructions

For the PoC, each developer runs Cortex locally alongside the OpenClaw gateway. We need:

- **Startup command:** How to run the Cortex FastAPI server locally (e.g., `uvicorn cortex.main:app`?)
- **Required environment variables:**
  - `CORTEX_ANTHROPIC_API_KEY` — the server-side Anthropic key (we have this)
  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — required for API key validation via Aegis
  - `SUPABASE_JWT_SECRET` — required for JWT auth
  - Any others?
- **Default port:** Is it `8000`? Configurable?
- **Minimum viable config:** What's the smallest set of env vars to get Apollo proxying requests? Can we skip Supabase for local dev?

### 3. Supabase dependency for auth

The Aegis auth layer (`_verify_api_key` in `dependencies.py`) calls Supabase to validate API keys. For local PoC:

**Questions:**

- Is a shared Supabase instance available for dev use? (URL + service role key)
- Or can we run Supabase locally? If so, what migrations/seed data are needed?
- Is there a dev-mode bypass for auth? (e.g., `CORTEX_DEV_MODE=true` to accept any token without Supabase)
- If not, would it be feasible to add one for local PoC? The auth middleware could return a hardcoded dev user when the flag is set.

### 4. Tool schema serialization bug status

We found `BUG-tool-schema-serialization.md` documenting that `ToolDefinition.input_schema` is serialized as `inputSchema` (camelCase) when proxying to Anthropic, causing 400 errors on all tool-use requests.

**Questions:**

- Has this been fixed? (Remove the alias from `ToolDefinition` in `types.py` line 136)
- If not, this blocks us — OpenClaw is an agentic tool-use system and nearly every request includes tools.

### 5. Model availability and configuration

**Questions:**

- Which models are seeded in `ai_model_pricing`? We need at least `claude-sonnet-4-5-20250929`.
- Are model IDs stable, or should we map OpenClaw model IDs to Cortex model IDs?
- Default tier for new users? (free? starter?)
- Default rate limits for PoC? (RPM, daily tokens, monthly spend)

### 6. Usage enrichment / metadata passthrough

OpenClaw can send `cortex_metadata` on each request for tracking. We'd like to use:

```json
{
  "cortex_metadata": {
    "source": "openclaw_gateway",
    "consumer_id": "sonance-openclaw",
    "session_id": "<openclaw-session-key>",
    "client_identifier": "openclaw-gateway/2026.2.18"
  }
}
```

**Questions:**

- Will this metadata flow through to usage logs?
- Should we use a specific `source` value for auto-project resolution?
- Any naming conventions we should follow?

---

## Configuration we'll set on the OpenClaw side

Once we have the answers above, OpenClaw config will look like:

```bash
# Environment variables
export SONANCE_APOLLO_BASE_URL=http://localhost:8000    # Cortex server URL
export SONANCE_CORTEX_API_KEY=ctx_xxxxxxxx_yyyyyyyy     # Cortex API key with AI scopes
```

Or in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "sonance-cortex": {
        "enabled": true,
        "config": {
          "apolloBaseUrl": "http://localhost:8000",
          "apiKey": "ctx_xxxxxxxx_yyyyyyyy"
        }
      }
    }
  }
}
```

---

## Quick test once we have credentials

```bash
# Verify Apollo is reachable and accepts the key
curl -s http://localhost:8000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: ctx_xxxxxxxx_yyyyyyyy" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello from OpenClaw"}]
  }' | python3 -m json.tool
```

Expected: 200 with a response containing `cortex_usage`.
If we get a 400 with `tools.0.custom.input_schema: Field required`, the tool schema bug (item 4) is not yet fixed.

---

## Timeline

This is the last blocker for the OpenClaw PoC. Once we have a working Cortex API key and confirm the tool schema bug is resolved, we can demo the full flow:

```
Employee opens OpenClaw Web UI
  → types a message
  → OpenClaw agent runs (with tools)
  → all AI requests route through Apollo
  → usage tracked, costs calculated
  → M365 MCP tools available for calendar/email
```
