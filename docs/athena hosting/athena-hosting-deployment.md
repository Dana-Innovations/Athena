# Athena Hosting & Deployment Guide

Detailed reference for hosting Athena (OpenClaw fork with Sonance Cortex integration) on **Vercel** (static UI) + **Fly.io** (gateway/WebSocket) with **Supabase Edge Function** (SSO proxy).

---

## Architecture Overview

```
┌─────────────────────────────────┐
│         User's Browser          │
└──────┬───────────────┬──────────┘
       │               │
       │ HTTPS          │ WSS
       ▼               ▼
┌──────────────┐  ┌──────────────────────┐
│   Vercel     │  │    Fly.io            │
│  (Static UI) │  │  (Gateway + WS)      │
│              │  │  athena-cortex.fly.dev│
│  Vite + Lit  │  │                      │
│  SPA build   │  │  Node.js gateway     │
│              │  │  Persistent volume    │
└──────┬───────┘  │  /data (state dir)   │
       │          └──────────┬───────────┘
       │                     │
       │                     │ HTTP (tools, audit, auth)
       │                     ▼
       │          ┌──────────────────────┐
       │          │   Cortex Backend     │
       │          │  (MCP tools, auth,   │
       │          │   billing, skills)   │
       │          └──────────────────────┘
       │
       │ SSO callback (CORS proxy)
       ▼
┌──────────────────────────────────┐
│  Supabase Edge Function          │
│  sso-auth-proxy                  │
│  Proxies central-check API call  │
│  to aiintranet.sonance.com       │
└──────────────────────────────────┘
```

**Why this split architecture?**

- **Vercel** serves the static UI (Vite + Lit Web Components SPA) with fast CDN delivery
- **Fly.io** runs the Node.js gateway which requires persistent WebSocket connections and a writable filesystem (for config, agent state, tool cache)
- Vercel can't run WebSocket servers (static hosting only), so the UI connects its WebSocket to Fly.io via the `gatewayUrl` config
- **Supabase Edge Function** is needed because the SSO callback (AI Intranet `central-check` API) is on a different domain and doesn't set CORS headers — the browser can't call it directly from the Vercel origin

---

## SSO Authentication Flow

```
Browser → AI Intranet (Auth0 → Okta SAML) → redirect back with auth_token
Browser → Supabase Edge Function (sso-auth-proxy) → AI Intranet central-check API
Browser receives session_token → WebSocket auth to Fly.io gateway
```

The SSO flow uses Sonance's AI Intranet (Auth0-backed with Okta SAML). On the callback, the browser must validate a single-use `auth_token` via the `central-check` API. Since `aiintranet.sonance.com` doesn't set CORS headers, a server-side proxy is required.

### Supabase Edge Function: `sso-auth-proxy`

Deployed to the Cortex Supabase project (`bylqwhuiuqbljpnpkdlz`). This function:

- Accepts POST with `{ auth_token, app_id }`
- Proxies to `https://aiintranet.sonance.com/api/central-check`
- Returns the response with proper CORS headers
- `verify_jwt: false` because the user has no JWT at callback time

The UI's `completeSsoCallback()` in `cortex-auth.ts` routes through this proxy when a `supabaseUrl` is provided in the bootstrap config.

---

## All Files Modified

### 1. `fly.toml`

**What**: Fly.io deployment configuration.

**Change**: Set `app = "athena-cortex"`.

**Key settings**:

- `OPENCLAW_STATE_DIR = "/data"` — persistent volume for config, cache, agent workspaces
- `NODE_OPTIONS = "--max-old-space-size=1536"` — memory limit for 2GB VM
- Process: `node dist/index.js gateway --allow-unconfigured --port 3000 --bind lan`
- Persistent volume mounted at `/data`
- `auto_stop_machines = false` — keeps WebSocket connections alive

---

### 2. `ui/src/ui/cortex-auth.ts`

**What**: SSO authentication callback handler.

**Change**: Added `supabaseUrl` parameter to `completeSsoCallback()` for CORS proxy routing.

**How it works**: When `supabaseUrl` is provided (from bootstrap config), the function routes the `central-check` API call through the Supabase Edge Function (`sso-auth-proxy`) instead of calling `aiintranet.sonance.com` directly. This avoids CORS errors when the UI is hosted on Vercel (different origin than AI Intranet).

---

### 3. `src/gateway/control-ui-contract.ts`

**What**: Shared type definition for bootstrap config between server and UI.

**Change**: Added `gatewayUrl?: string` field to `ControlUiBootstrapConfig`.

---

### 4. `ui/src/ui/controllers/control-ui-bootstrap.ts`

**What**: Loads bootstrap config from `/__openclaw/control-ui-config.json` and applies to host state.

**Change**: Added `gatewayUrl?: string` to `ControlUiBootstrapState` type and copies from parsed config.

---

### 5. `ui/src/ui/app-lifecycle.ts`

**What**: Orchestrates app lifecycle — loads bootstrap config, then connects gateway.

**Changes**: Added `gatewayUrl?: string` to `LifecycleHost` type. Before both `connectGateway` calls, overrides settings if `gatewayUrl` is set.

**Why**: The default WebSocket URL is derived from `location.host`. When the UI is on Vercel but the gateway is on Fly.io, we need to override this to point at `wss://athena-cortex.fly.dev`.

---

### 6. `ui/public/__openclaw/control-ui-config.json`

**What**: Static bootstrap config served by Vercel.

```json
{
  "basePath": "",
  "assistantName": "OpenClaw",
  "authMode": "cortex",
  "supabaseUrl": "https://bylqwhuiuqbljpnpkdlz.supabase.co",
  "supabaseAnonKey": "eyJhbGci...",
  "aiIntranetUrl": "https://aiintranet.sonance.com",
  "appId": "1b9007a0-dfd2-473b-9e94-96b397d50b02",
  "gatewayUrl": "wss://athena-cortex.fly.dev"
}
```

**Note**: When the gateway serves the UI directly (e.g., accessing `https://athena-cortex.fly.dev/` directly), the server generates bootstrap config dynamically and `gatewayUrl` is not needed. This static file is only used when the UI is served from a different origin (Vercel).

---

### 7. `src/config/sonance-defaults.ts`

**What**: Centralizes Sonance-specific config overrides.

**Changes**: `OPENCLAW_ALLOWED_ORIGINS` env var support, auto-disable device pairing in cortex mode, auto-enable `cortex-tools` plugin with derived config.

---

### 8. `src/gateway/server/ws-connection/message-handler.ts`

**What**: WebSocket handshake handler.

**Change**: Fixed `canSkipDevice` gate to also consider `allowControlUiBypass && authOk`.

---

### 9. `ui/src/ui/app-render.ts`

**What**: Main UI render template.

**Change**: Removed the upstream OpenClaw update banner (replaced with `${nothing}`).

---

### 10. `extensions/sonance-cortex/src/cortex-client.ts`

**What**: Cortex API client.

**Change**: Fixed `listTools()` to unwrap `res.tools` and map `input_schema` → `parameters`.

---

### 11. `extensions/cortex-tools/src/agent-sync.ts`

**What**: Auto-generates one agent per Cortex MCP in `athena.json`.

**Change**: Creates `athena.json` if missing instead of skipping.

---

### 12–13. `src/cli/gateway-cli/run.ts` & `src/gateway/server-runtime-config.ts`

**What**: Auth mode validation for non-loopback binding.

**Change**: Added `cortex` and `sonance-sso` to valid auth mode list.

---

## Environment Variables (Fly.io Secrets)

Set via `fly secrets set --stage` then `fly deploy`:

| Secret                     | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `SONANCE_CORTEX_API_URL`   | Cortex backend URL (used by both `sonance-cortex` and `cortex-tools` plugins)  |
| `SONANCE_CORTEX_API_KEY`   | Cortex API key for service-to-service auth                                     |
| `CORTEX_URL`               | Same as `SONANCE_CORTEX_API_URL` (legacy compat for `cortex-tools`)            |
| `CORTEX_API_KEY`           | Same as `SONANCE_CORTEX_API_KEY` (legacy compat for `cortex-tools`)            |
| `AI_INTRANET_URL`          | AI Intranet URL for SSO (`https://aiintranet.sonance.com`)                     |
| `AI_INTRANET_APP_ID`       | App ID registered in AI Intranet                                               |
| `AI_INTRANET_APP_API_KEY`  | App API key for AI Intranet                                                    |
| `CORTEX_SUPABASE_URL`      | Supabase project URL for Cortex auth                                           |
| `CORTEX_SUPABASE_ANON_KEY` | Supabase anon key for Cortex auth                                              |
| `OPENCLAW_GATEWAY_TOKEN`   | Gateway authentication token                                                   |
| `OPENCLAW_ALLOWED_ORIGINS` | Comma-separated allowed origins (e.g., `https://athena-vercel-url.vercel.app`) |

**Non-secret env vars** (in `fly.toml`):

| Variable               | Value                       | Purpose                     |
| ---------------------- | --------------------------- | --------------------------- |
| `NODE_ENV`             | `production`                | Production mode             |
| `OPENCLAW_PREFER_PNPM` | `1`                         | Use pnpm package manager    |
| `OPENCLAW_STATE_DIR`   | `/data`                     | Persistent volume for state |
| `NODE_OPTIONS`         | `--max-old-space-size=1536` | Memory limit for 2GB VM     |

---

## Deployment Steps

### Fly.io (Gateway)

```bash
# First time setup
fly launch --name athena-cortex --region iad --no-deploy
fly volumes create openclaw_data --region iad --size 1

# Set secrets (all at once with --stage to avoid multiple deploys)
fly secrets set --stage \
  SONANCE_CORTEX_API_URL="https://your-cortex-url" \
  SONANCE_CORTEX_API_KEY="ctx_your_key" \
  CORTEX_URL="https://your-cortex-url" \
  CORTEX_API_KEY="ctx_your_key" \
  AI_INTRANET_URL="https://aiintranet.sonance.com" \
  AI_INTRANET_APP_ID="your-app-id" \
  AI_INTRANET_APP_API_KEY="your-app-api-key" \
  CORTEX_SUPABASE_URL="https://your-project.supabase.co" \
  CORTEX_SUPABASE_ANON_KEY="your-anon-key" \
  OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
  OPENCLAW_ALLOWED_ORIGINS="https://your-vercel-app.vercel.app"

# Deploy
fly deploy --remote-only

# Subsequent deploys
fly deploy --remote-only
```

**Note on `fly secrets set`**: Use `--stage` flag to avoid a nil pointer dereference crash that occurs with the auto-deploy triggered by `fly secrets set` (flyctl bug). Set all secrets with `--stage`, then deploy separately.

### Vercel (UI)

Vercel auto-deploys from git pushes to `main`. The key file is `ui/public/__openclaw/control-ui-config.json` which must have the correct `gatewayUrl`, `supabaseUrl`, `aiIntranetUrl`, and `appId`.

```bash
git add -A && git commit -m "your message" && git push
```

Vercel builds the Vite SPA from the `ui/` directory.

### Supabase Edge Function (SSO Proxy)

The `sso-auth-proxy` Edge Function is already deployed to the shared Cortex Supabase project (`bylqwhuiuqbljpnpkdlz`). No additional deployment needed — Athena uses the same Supabase project as Elmo.

---

## Troubleshooting

### "origin not allowed" after deploying

Check that `OPENCLAW_ALLOWED_ORIGINS` includes your Vercel URL:

```bash
fly secrets list --app athena-cortex
# Should show OPENCLAW_ALLOWED_ORIGINS
```

### Agents not appearing after deploy

1. SSH into the machine and check for `athena.json`:
   ```bash
   fly ssh console --app athena-cortex -C "cat /data/athena.json"
   ```
2. If missing or empty, restart the machine:
   ```bash
   fly machine restart --app athena-cortex <machine-id>
   ```
3. Check logs for cortex-tools output:
   ```bash
   fly logs --app athena-cortex --no-tail
   ```
   Look for `Cortex Tools: connecting to` and `Cortex Tools: registered N tools`.

### SSO login fails (CORS error)

1. Verify the Supabase Edge Function is deployed:
   ```bash
   supabase functions list
   ```
2. Check that `supabaseUrl` in `control-ui-config.json` matches your Supabase project
3. Check Edge Function logs in the Supabase dashboard

### WebSocket won't connect

1. Verify `gatewayUrl` in `control-ui-config.json` points to the Fly.io app
2. Check that Fly.io machine is running:
   ```bash
   fly status --app athena-cortex
   ```
3. Check gateway logs for connection attempts:
   ```bash
   fly logs --app athena-cortex --no-tail
   ```

### Tools not loading (empty tool list)

1. Check cortex-tools cache:
   ```bash
   fly ssh console --app athena-cortex -C "ls -la /data/cortex-tools-cache.json"
   ```
2. Verify Cortex backend is reachable from Fly.io:
   ```bash
   fly ssh console --app athena-cortex -C "curl -s -o /dev/null -w '%{http_code}' -H 'X-API-Key: test' https://your-cortex-url/health"
   ```

---

## Known Issues & Solutions

See the Elmo deployment doc (`/docs/elmo hosting/elmo-hosting-deployment.md`) for the full list of 10 issues encountered during the initial Elmo deployment. All fixes have been applied to Athena's codebase. Key issues to watch for:

1. **CORS on SSO Callback** → Supabase Edge Function proxy
2. **WebSocket on Vercel** → `gatewayUrl` pointing to Fly.io
3. **"origin not allowed"** → `OPENCLAW_ALLOWED_ORIGINS` env var
4. **"pairing required"** → Auto-disabled in cortex mode
5. **"device identity required"** → `canSkipDevice` fix in message-handler
6. **"tools is not iterable"** → `listTools()` response unwrapping fix
7. **Auth bind check** → `cortex`/`sonance-sso` added to valid modes
8. **`fly secrets set` crash** → Use `--stage` flag
9. **Agents missing** → `cortex-tools` auto-enabled + `athena.json` auto-created
10. **Vercel showing old UI** → Commit and push to trigger rebuild
