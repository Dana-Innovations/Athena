# Apollo PoC Setup Guide

How to connect the OpenClaw gateway to Cortex Apollo for AI model access.

---

## Prerequisites

- OpenClaw fork cloned and built (`pnpm install && pnpm build`)
- Cortex repo cloned at `../Cortex/Cortex` (relative to this repo)
- Python 3.11+ with pip
- Shared dev Supabase credentials (from Cortex team)
- A Cortex API key (`ctx_...`) with scopes: `ai:messages`, `ai:messages:stream`, `ai:models`

---

## Step 1: Start the Cortex server

```bash
cd /path/to/Cortex/Cortex/core

# Install dependencies (first time only)
pip install -e ".[dev]"

# Create .env file with credentials
cat > .env << 'EOF'
CORTEX_ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
CORTEX_SUPABASE_URL=https://yourproject.supabase.co
CORTEX_SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
CORTEX_DEBUG=true
CORTEX_LOG_LEVEL=DEBUG
CORTEX_APP_ENV=development
EOF

# Start the server
uvicorn cortex.main:app --host 0.0.0.0 --port 8000 --reload
```

Verify it's running:

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

---

## Step 2: Verify Apollo accepts your API key

```bash
curl -s http://localhost:8000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: ctx_your_key_here" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 50,
    "messages": [{"role": "user", "content": "Say hello in one word"}]
  }' | python3 -m json.tool
```

Expected: 200 response with `cortex_usage` object containing `cost_usd`,
`input_tokens`, `output_tokens`, `request_id`.

---

## Step 3: Configure OpenClaw

Set the two environment variables that wire OpenClaw to Apollo:

```bash
export SONANCE_APOLLO_BASE_URL=http://localhost:8000
export SONANCE_CORTEX_API_KEY=ctx_your_key_here
```

Or add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "sonance-cortex": {
        "enabled": true,
        "config": {
          "apolloBaseUrl": "http://localhost:8000",
          "apiKey": "ctx_your_key_here"
        }
      }
    }
  }
}
```

---

## Step 4: Start the OpenClaw gateway

```bash
cd /path/to/Athena/Athena
pnpm openclaw gateway run
```

You should see in the logs:

```
[sonance-cortex] Apollo proxy — authenticating to Apollo for anthropic
[sonance-cortex] central key resolver registered
```

---

## Step 5: Test end-to-end

Open the Web UI (the URL is printed when the gateway starts) and send a message.
The agent should respond. In the Cortex server logs you'll see the proxied
request with usage tracking.

---

## How it works

```
OpenClaw Web UI → OpenClaw Gateway → Apollo (localhost:8000)
                                        ↓
                                   Aegis validates ctx_ key
                                        ↓
                                   Rate limit + model access check
                                        ↓
                                   Anthropic API (server-side sk-ant- key)
                                        ↓
                                   Response + cortex_usage
                                        ↓
                                   ← back to OpenClaw
```

- The Anthropic API key (`sk-ant-...`) lives only on the Cortex server
- OpenClaw authenticates with a Cortex API key (`ctx_...`)
- Apollo handles billing, rate limiting, usage tracking
- Employees never see or need the Anthropic key

---

## Troubleshooting

| Symptom                                               | Cause                                        | Fix                                                            |
| ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `401 Authentication required`                         | Bad or missing `ctx_` key                    | Check `SONANCE_CORTEX_API_KEY` value                           |
| `403 Missing required scopes`                         | Key missing `ai:messages` scope              | Recreate key with correct scopes                               |
| `503 AI proxy is not enabled`                         | `CORTEX_ANTHROPIC_API_KEY` not set on Cortex | Set it in Cortex's `.env`                                      |
| `503 Anthropic API key not configured`                | Same as above                                | Same fix                                                       |
| `500 Database connection not configured`              | Supabase env vars missing on Cortex          | Set `CORTEX_SUPABASE_URL` + `CORTEX_SUPABASE_SERVICE_ROLE_KEY` |
| `400 tools.0.custom.input_schema: Field required`     | Tool schema bug (should be fixed)            | Verify Cortex has the fix from `types.py`                      |
| `No API key found for provider "anthropic"`           | OpenClaw not configured for Apollo           | Set `SONANCE_APOLLO_BASE_URL` + `SONANCE_CORTEX_API_KEY`       |
| Gateway log: `[sonance-cortex] no API key configured` | Plugin config missing                        | Set `SONANCE_CORTEX_API_KEY` env var                           |

---

## Fallback: Direct mode (no Cortex needed)

If Cortex isn't running yet, you can bypass Apollo entirely:

```bash
export SONANCE_ANTHROPIC_API_KEY=sk-ant-your-key-here
pnpm openclaw gateway run
```

This talks directly to `api.anthropic.com`. No billing or usage tracking — just
a quick way to test the gateway while waiting for Cortex credentials.
