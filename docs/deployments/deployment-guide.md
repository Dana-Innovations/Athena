# Athena Cortex Deployment Guide

## Architecture Overview

Athena supports three deployment targets:

| Target                   | URL                          | Use Case                      |
| ------------------------ | ---------------------------- | ----------------------------- |
| **Fly.io** (primary)     | `https://cortex.sonance.com` | Production SaaS deployment    |
| **Docker Compose**       | `https://athena.sonance.dev` | On-premise / self-hosted      |
| **Azure Container Apps** | ACR FQDN                     | Enterprise Azure environments |

All targets run the same Docker image: a Node.js gateway serving both the backend API (WebSocket + REST) and the Vite-built UI.

```
                    +-----------------+
                    |   Cloudflare    |
                    |  (DNS only)     |
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
     cortex.sonance.com          athena-cortex.fly.dev
              |                             |
              +-------------+---------------+
                            |
                   +--------v--------+
                   |    Fly.io TLS   |
                   |  (Let's Encrypt)|
                   +--------+--------+
                            |
                   +--------v--------+
                   |  Gateway :3000  |
                   |  (Node.js)      |
                   |  - WebSocket    |
                   |  - REST API     |
                   |  - Static UI    |
                   +--------+--------+
                            |
                   +--------v--------+
                   |   /data volume  |
                   |  (persistent)   |
                   +-----------------+
```

---

## DNS & Domain Setup

### Current Configuration (Cloudflare)

Domain: `sonance.com` (managed in Cloudflare)

| Type | Name     | Content                  | Proxy                 |
| ---- | -------- | ------------------------ | --------------------- |
| A    | `cortex` | `66.241.125.251`         | DNS only (grey cloud) |
| AAAA | `cortex` | `2a09:8280:1::dc:7e87:0` | DNS only (grey cloud) |

**Important:** Proxy must be **DNS only** (grey cloud). Fly.io manages its own TLS via Let's Encrypt. Cloudflare proxy would interfere with certificate issuance and WebSocket connections.

### Fly.io Certificate

The TLS certificate is managed by Fly.io (Let's Encrypt, auto-renewed).

```bash
# Check certificate status
flyctl certs check cortex.sonance.com -a athena-cortex

# Add a new custom domain
flyctl certs add <domain> -a athena-cortex

# List all certificates
flyctl certs list -a athena-cortex
```

### Adding a New Custom Domain

1. Add DNS records in Cloudflare (A + AAAA, DNS only)
2. Run `flyctl certs add <domain> -a athena-cortex`
3. Wait for verification: `flyctl certs check <domain> -a athena-cortex`
4. Update `OPENCLAW_ALLOWED_ORIGINS` secret to include the new domain

---

## Fly.io Deployment (Primary)

### Configuration

**File:** `fly.toml`

| Setting       | Value                                       |
| ------------- | ------------------------------------------- |
| App name      | `athena-cortex`                             |
| Region        | `iad` (US East - Virginia)                  |
| VM            | `shared-cpu-2x`, 2048 MB                    |
| Internal port | 3000                                        |
| Volume        | `openclaw_data` mounted at `/data`          |
| Auto-stop     | Disabled (persistent WebSocket connections) |
| Min machines  | 1                                           |
| Force HTTPS   | Yes                                         |

**Process command:**

```
node dist/index.js gateway --allow-unconfigured --port 3000 --bind lan
```

- `--bind lan`: Binds to fly's private network interface (required for fly-proxy)
- `--allow-unconfigured`: Starts without requiring a pre-existing config
- `--port 3000`: Matches `internal_port` in fly.toml

### Secrets (Environment Variables)

```bash
# List current secrets
flyctl secrets list -a athena-cortex

# Set a secret (triggers automatic redeployment)
flyctl secrets set KEY=value -a athena-cortex

# Set multiple secrets
flyctl secrets set KEY1=val1 KEY2=val2 -a athena-cortex
```

**Required secrets:**

| Secret                     | Description                            |
| -------------------------- | -------------------------------------- |
| `OPENCLAW_GATEWAY_TOKEN`   | Auth token for gateway API access      |
| `OPENCLAW_ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) |
| `ANTHROPIC_API_KEY`        | Anthropic API key for Claude models    |
| `CORTEX_URL`               | Cortex backend URL                     |
| `CORTEX_API_KEY`           | Cortex API key                         |
| `AI_INTRANET_URL`          | SSO provider URL                       |
| `AI_INTRANET_APP_ID`       | SSO application ID                     |
| `AI_INTRANET_APP_API_KEY`  | SSO API key                            |
| `CORTEX_SUPABASE_URL`      | Supabase project URL                   |
| `CORTEX_SUPABASE_ANON_KEY` | Supabase anonymous key                 |

Current CORS config:

```
OPENCLAW_ALLOWED_ORIGINS=https://cortex.sonance.com,https://athena-cortex.fly.dev
```

### Deploy Commands

```bash
# Standard deployment (builds and deploys)
flyctl deploy -a athena-cortex

# Deploy with verbose output
flyctl deploy -a athena-cortex --verbose

# Check deployment status
flyctl status -a athena-cortex

# View logs
flyctl logs -a athena-cortex

# SSH into the running machine
flyctl ssh console -a athena-cortex

# Restart the machine
flyctl machines restart -a athena-cortex
```

### Volume Management

```bash
# List volumes
flyctl volumes list -a athena-cortex

# The volume stores gateway state at /data
# This includes agent profiles, workspace data, and configuration
```

### Private Deployment (No Public Access)

**File:** `fly.private.toml`

For internal-only deployments with no public IP:

- No `[http_service]` block
- Access only via `fly proxy`, WireGuard, or SSH
- Use for staging or internal tools

```bash
flyctl deploy -a athena-cortex --config fly.private.toml
```

---

## Docker Build Process

### Dockerfile

**Base:** `node:22-bookworm`

**Build stages:**

1. **Install Bun** - Used for build scripts
2. **Enable corepack** - Node.js package manager support
3. **Install dependencies** - `pnpm install --frozen-lockfile`
4. **Optional: Install Chromium** - Set `OPENCLAW_INSTALL_BROWSER=1` build arg for Playwright support
5. **Copy source & build**
   ```bash
   pnpm build        # TypeScript compilation (tsdown)
   pnpm ui:build     # Vite build for UI → dist/control-ui/
   ```
6. **Security hardening** - Runs as non-root `node` user (UID 1000)

**Default CMD:**

```
node openclaw.mjs gateway --allow-unconfigured
```

### Build Arguments

| Arg                            | Default | Description                                        |
| ------------------------------ | ------- | -------------------------------------------------- |
| `OPENCLAW_INSTALL_BROWSER`     | (empty) | Set to `1` to pre-install Chromium + Xvfb (~300MB) |
| `OPENCLAW_DOCKER_APT_PACKAGES` | (empty) | Additional apt packages to install                 |

---

## Docker Compose (On-Premise)

**File:** `deploy/docker-compose.yml`

Two-container setup:

1. **nginx** - Reverse proxy with SSL termination (Let's Encrypt)
   - Ports: 80 (redirect), 443 (HTTPS)
   - Config: `deploy/nginx/nginx.conf`

2. **athena** - Gateway application
   - Port: 18789 (internal), 3978 (Azure Bot webhook)
   - Volume: `gateway-data` at `~/.openclaw`
   - Config: `deploy/openclaw.json` (read-only mount)
   - Health check: `curl -f http://localhost:18789/` (30s interval)
   - Memory limit: 3GB

```bash
# Start
cd deploy
docker compose up -d

# View logs
docker compose logs -f athena

# Rebuild and restart
docker compose up -d --build
```

---

## Azure Container Apps

**File:** `deploy/container-app.yaml`

Sidecar architecture:

| Container        | Image                                       | Port            | Purpose                |
| ---------------- | ------------------------------------------- | --------------- | ---------------------- |
| `athena-gateway` | `sonanceathena.azurecr.io/athena-gateway:*` | 3978            | Main gateway           |
| `cortex-sidecar` | `sonanceathena.azurecr.io/cortex:latest`    | 8000 (internal) | Tool execution backend |

**Setup script:** `deploy/setup-container-app.sh`

```bash
# Deploy to Azure
cd deploy
./setup-container-app.sh
```

---

## Environment Variables

**Reference file:** `deploy/.env.template`

### Gateway Core

| Variable                   | Required | Description                                 |
| -------------------------- | -------- | ------------------------------------------- |
| `OPENCLAW_GATEWAY_TOKEN`   | Yes      | Gateway auth token (`openssl rand -hex 32`) |
| `OPENCLAW_STATE_DIR`       | No       | State directory (default: `~/.openclaw`)    |
| `OPENCLAW_ALLOWED_ORIGINS` | Yes      | CORS allowed origins (comma-separated)      |
| `NODE_ENV`                 | No       | `production` for deployments                |

### Model Provider Keys

| Variable             | Description        |
| -------------------- | ------------------ |
| `ANTHROPIC_API_KEY`  | Anthropic (Claude) |
| `OPENAI_API_KEY`     | OpenAI (GPT)       |
| `GEMINI_API_KEY`     | Google (Gemini)    |
| `OPENROUTER_API_KEY` | OpenRouter         |

Multiple keys supported: `ANTHROPIC_API_KEYS=key1,key2`

### Cortex Backend

| Variable                 | Description               |
| ------------------------ | ------------------------- |
| `CORTEX_URL`             | Cortex API endpoint       |
| `CORTEX_API_KEY`         | Cortex authentication key |
| `SONANCE_CORTEX_API_URL` | Sonance Cortex plugin URL |
| `SONANCE_CORTEX_API_KEY` | Sonance Cortex plugin key |

### SSO / Authentication

| Variable                  | Description                      |
| ------------------------- | -------------------------------- |
| `AI_INTRANET_URL`         | `https://aiintranet.sonance.com` |
| `AI_INTRANET_APP_ID`      | SSO application ID               |
| `AI_INTRANET_APP_API_KEY` | SSO API key                      |

### Supabase

| Variable                   | Description            |
| -------------------------- | ---------------------- |
| `CORTEX_SUPABASE_URL`      | Supabase project URL   |
| `CORTEX_SUPABASE_ANON_KEY` | Supabase anonymous key |

### Channel Tokens (Optional)

| Variable               | Description             |
| ---------------------- | ----------------------- |
| `MSTEAMS_APP_ID`       | Azure Bot app ID        |
| `MSTEAMS_APP_PASSWORD` | Azure Bot client secret |
| `MSTEAMS_TENANT_ID`    | Azure tenant ID         |
| `TELEGRAM_BOT_TOKEN`   | Telegram bot token      |
| `DISCORD_BOT_TOKEN`    | Discord bot token       |
| `SLACK_BOT_TOKEN`      | Slack bot token         |
| `SLACK_APP_TOKEN`      | Slack app-level token   |

---

## CI/CD Pipeline

### GitHub Actions

#### `docker-release.yml` - Docker Image Build

**Trigger:** Push to `main` or tags matching `v*`

**Pipeline:**

1. Build AMD64 image (Blacksmith runner)
2. Build ARM64 image (Blacksmith ARM runner)
3. Create multi-platform manifest

**Registry:** `ghcr.io`
**Tags:** `main` (latest) or `v{version}`

#### `ci.yml` - Test Suite

**Stages:**

1. Scope detection (docs-only, changed areas)
2. Build artifacts (`pnpm build`)
3. Parallel checks: Node tests (vitest), protocol checks, Bun tests
4. Type checking, linting (oxlint), formatting (oxfmt)
5. Secrets scanning (`detect-secrets`)
6. Platform tests: Windows, macOS (Swift + TS), Android (Gradle)

---

## UI Configuration

### Build

The UI is a Vite SPA built into `dist/control-ui/` and served by the gateway.

```bash
pnpm ui:build    # Production build
pnpm ui:dev      # Dev server on port 5173
```

### Runtime Config

**File:** `ui/public/__openclaw/control-ui-config.json`

```json
{
  "basePath": "",
  "assistantName": "OpenClaw",
  "authMode": "cortex",
  "supabaseUrl": "https://bylqwhuiuqbljpnpkdlz.supabase.co",
  "supabaseAnonKey": "<jwt>",
  "aiIntranetUrl": "https://aiintranet.sonance.com",
  "appId": "1b9007a0-dfd2-473b-9e94-96b397d50b02",
  "gatewayUrl": "wss://cortex.sonance.com"
}
```

This file is baked into the Docker image at build time. To change `gatewayUrl`, update this file and redeploy.

---

## Common Operations

### Full Deployment Checklist

```bash
# 1. Commit changes
git add <files>
git commit -m "description"

# 2. Deploy
flyctl deploy -a athena-cortex

# 3. Verify
flyctl status -a athena-cortex
flyctl logs -a athena-cortex
curl -I https://cortex.sonance.com
```

### Rolling Back

```bash
# List recent deployments
flyctl releases -a athena-cortex

# Rollback to previous release
flyctl deploy -a athena-cortex --image <previous-image-ref>
```

### Scaling

```bash
# Scale VM size
flyctl scale vm shared-cpu-4x -a athena-cortex

# Scale memory
flyctl scale memory 4096 -a athena-cortex

# Add machines (for HA)
flyctl scale count 2 -a athena-cortex
```

### Monitoring

```bash
# Live logs
flyctl logs -a athena-cortex

# Machine status
flyctl status -a athena-cortex

# SSH into machine
flyctl ssh console -a athena-cortex
```

---

## Troubleshooting

### "App is not listening on the expected address"

This warning appears during deployment because the gateway uses `--bind lan` which binds to Fly's private network interface rather than `0.0.0.0`. This is expected behavior - the health check still passes via the private network.

### Certificate Not Verifying

1. Ensure both A and AAAA DNS records exist in Cloudflare
2. Ensure proxy is set to **DNS only** (grey cloud, not orange)
3. Wait 2-5 minutes for DNS propagation
4. Check: `flyctl certs check <domain> -a athena-cortex`

### CORS Errors

Update the allowed origins secret:

```bash
flyctl secrets set OPENCLAW_ALLOWED_ORIGINS="https://domain1.com,https://domain2.com" -a athena-cortex
```

### WebSocket Connection Failed

1. Verify `gatewayUrl` in `control-ui-config.json` uses `wss://` (not `ws://`)
2. Verify the domain is in `OPENCLAW_ALLOWED_ORIGINS`
3. Check gateway logs: `flyctl logs -a athena-cortex`

### Admin Tabs Showing Spinners

API calls have 30-second timeouts. If tabs spin indefinitely:

1. Check Cortex backend is running and accessible
2. Verify `CORTEX_URL` and `CORTEX_API_KEY` secrets
3. Check gateway logs for timeout errors

---

## Key Files Reference

| File                                          | Purpose                               |
| --------------------------------------------- | ------------------------------------- |
| `fly.toml`                                    | Fly.io production config              |
| `fly.private.toml`                            | Fly.io private (no public IP) config  |
| `Dockerfile`                                  | Container image build                 |
| `deploy/docker-compose.yml`                   | On-premise multi-container setup      |
| `deploy/container-app.yaml`                   | Azure Container Apps manifest         |
| `deploy/nginx/nginx.conf`                     | HTTPS reverse proxy                   |
| `deploy/.env.template`                        | Environment variables reference       |
| `deploy/entrypoint.sh`                        | Docker entrypoint (config generation) |
| `deploy/openclaw.json`                        | Gateway channel/plugin config         |
| `.github/workflows/docker-release.yml`        | Multi-arch Docker image CI            |
| `.github/workflows/ci.yml`                    | Test suite CI                         |
| `ui/public/__openclaw/control-ui-config.json` | UI runtime config                     |
