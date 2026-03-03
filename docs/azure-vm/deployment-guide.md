# Athena + Cortex Production Deployment Guide

## Azure VM — Docker Compose Architecture

This guide covers deploying Athena Gateway and Cortex API on a single Azure VM using Docker Compose, serving 100+ users via Telegram, Teams, Slack, Discord, and other messaging channels.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Why Not Serverless?](#why-not-serverless)
3. [Azure VM Sizing](#azure-vm-sizing)
4. [Architecture Diagram](#architecture-diagram)
5. [Traffic Flow by Channel](#traffic-flow-by-channel)
6. [Prerequisites](#prerequisites)
7. [Step 1 — Provision Azure VM](#step-1--provision-azure-vm)
8. [Step 2 — Configure DNS](#step-2--configure-dns)
9. [Step 3 — Install Docker on the VM](#step-3--install-docker-on-the-vm)
10. [Step 4 — Clone Repositories](#step-4--clone-repositories)
11. [Step 5 — Create Cortex Dockerfile](#step-5--create-cortex-dockerfile)
12. [Step 6 — Create Docker Compose File](#step-6--create-docker-compose-file)
13. [Step 7 — Create Caddyfile](#step-7--create-caddyfile)
14. [Step 8 — Configure Environment Variables](#step-8--configure-environment-variables)
15. [Step 9 — Configure Athena Gateway](#step-9--configure-athena-gateway)
16. [Step 10 — Enable Messaging Channels](#step-10--enable-messaging-channels)
17. [Step 11 — Deploy](#step-11--deploy)
18. [Step 12 — Verify Deployment](#step-12--verify-deployment)
19. [Channel-Specific Setup](#channel-specific-setup)
20. [Monitoring and Operations](#monitoring-and-operations)
21. [Backup Strategy](#backup-strategy)
22. [Troubleshooting](#troubleshooting)
23. [Future Scaling Path](#future-scaling-path)
24. [Cost Estimate](#cost-estimate)

---

## Architecture Overview

The deployment runs **two services** behind a **Caddy reverse proxy** on a single Azure VM:

| Service            | Runtime                        | Role                                                                                                                                   |
| ------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Athena Gateway** | Node.js 22 (Docker)            | Long-running agent gateway — manages WebSocket connections, messaging channel integrations, agent subprocess runs, session persistence |
| **Cortex API**     | Python 3.12 / FastAPI (Docker) | REST API backend — AI proxy (Apollo), MCP tool bridge, skills engine, API key management, OAuth, usage tracking                        |
| **Caddy**          | Go (Docker)                    | Reverse proxy — auto-TLS via Let's Encrypt, routes HTTPS traffic to internal services                                                  |

All persistent data flows through **Supabase** (managed PostgreSQL in the cloud). The only local state is Athena's session files (JSON on a Docker volume).

---

## Why Not Serverless?

Athena Gateway **cannot** run as serverless functions. Here's why:

| Requirement            | Serverless Compatible? | Reason                                                 |
| ---------------------- | ---------------------- | ------------------------------------------------------ |
| Telegram long-polling  | No                     | Infinite loop calling `getUpdates` every 30 seconds    |
| Teams webhook receiver | No                     | Needs a persistent HTTP server accepting POSTs         |
| Discord bot            | No                     | Persistent outbound WebSocket to Discord gateway       |
| Slack Socket Mode      | No                     | Persistent outbound WebSocket to Slack                 |
| WhatsApp (Baileys)     | No                     | Persistent WebSocket session to WhatsApp Web           |
| Signal                 | No                     | Requires signal-cli Java daemon + SSE connection       |
| WebSocket server (UI)  | No                     | `ws.WebSocketServer` with in-memory client tracking    |
| Agent subprocess runs  | No                     | Claude CLI runs as child processes tied to the gateway |
| Session deduplication  | No                     | In-memory dedup map with 5-minute TTL                  |

Cortex is **mostly** stateless per-request (Supabase-backed), but co-locating it on the same VM is recommended because:

1. Background asyncio tasks (connection sync + AD sync) run every 4 hours as infinite loops — exceeds Vercel execution limits
2. DevServer MCP spawns OS subprocesses — incompatible with managed serverless
3. Localhost calls from Athena to Cortex have sub-1ms latency vs 50-200ms cross-network
4. Single VM = simpler ops, one set of logs, one deployment target

---

## Azure VM Sizing

**Recommended: Standard_D4s_v5 (4 vCPUs, 16 GB RAM)**

| Component              | Estimated Memory | Notes                                                      |
| ---------------------- | ---------------- | ---------------------------------------------------------- |
| Athena Gateway         | 1-2 GB           | I/O-bound; LLM inference offloaded to Anthropic via Cortex |
| Cortex API (2 workers) | 1-2 GB           | Stateless per-request + background tasks                   |
| Caddy                  | ~100 MB          | Minimal reverse proxy                                      |
| signal-cli (optional)  | 500 MB - 1 GB    | JVM process, only if Signal channel enabled                |
| OS + headroom          | 4-6 GB           | Burst capacity for concurrent agent runs                   |
| **Total**              | **~16 GB**       | Fits Standard_D4s_v5                                       |

Disk: **64 GB Premium SSD (P6)** — session files are small, Cortex workspace may grow.

---

## Architecture Diagram

```
          INTERNET
          (Telegram Bot API, Azure Bot Framework, Discord Gateway,
           Slack, WhatsApp, Signal, Web browsers)
                              |
                    +-------------------+
                    |   Azure DNS Zone  |
                    | athena.sonance.com|
                    | cortex.sonance.com|
                    +-------------------+
                              |
                    +-------------------+
                    |    Azure NSG      |
                    | Inbound: 80, 443  |
                    | Outbound: all     |
                    +-------------------+
                              |
          +===============================================+
          |        Azure VM (Standard_D4s_v5)             |
          |        4 vCPU, 16 GB RAM, Ubuntu 24.04        |
          +===============================================+
          |                                               |
          |   +---------------------------------------+   |
          |   | Caddy (reverse proxy + auto-TLS)      |   |
          |   | Listens: :80, :443                    |   |
          |   | athena.sonance.com -> gateway:18789   |   |
          |   | athena.../api/messages -> gw:3978     |   |
          |   | cortex.sonance.com -> cortex:8000     |   |
          |   +---------------------------------------+   |
          |        |                    |                  |
          |        v                    v                  |
          |   +-----------+      +------------+           |
          |   | Athena    |      | Cortex     |           |
          |   | Gateway   |      | API        |           |
          |   | :18789    |----->| :8000      |           |
          |   | :3978     |      |            |           |
          |   | (Node.js) |      | (FastAPI)  |           |
          |   +-----------+      +------------+           |
          |        |                    |                  |
          |        v                    v                  |
          |   +-----------+      +------------+           |
          |   | /data     |      | Supabase   |           |
          |   | (volume)  |      | (cloud PG) |           |
          |   | sessions, |      | users, keys|           |
          |   | config    |      | usage, MCP |           |
          |   +-----------+      +------------+           |
          |                                               |
          |   +---------------------------------------+   |
          |   | Optional Sidecars                     |   |
          |   | - signal-cli (Java, if Signal needed) |   |
          |   +---------------------------------------+   |
          +===============================================+
```

---

## Traffic Flow by Channel

| Channel                 | Direction     | Protocol                              | Port Needed     |
| ----------------------- | ------------- | ------------------------------------- | --------------- |
| **Telegram** (polling)  | Outbound only | HTTPS long-poll to `api.telegram.org` | None inbound    |
| **Telegram** (webhook)  | Inbound       | HTTPS POST from Telegram              | 443 (via Caddy) |
| **Teams**               | Inbound       | HTTPS POST from Azure Bot Framework   | 443 -> 3978     |
| **Discord**             | Outbound only | WebSocket to Discord gateway          | None inbound    |
| **Slack** (Socket Mode) | Outbound only | WebSocket to Slack                    | None inbound    |
| **Slack** (Events API)  | Inbound       | HTTPS POST from Slack                 | 443 (via Caddy) |
| **WhatsApp** (Baileys)  | Outbound only | WebSocket to WhatsApp Web             | None inbound    |
| **Signal**              | Local only    | HTTP to signal-cli daemon             | Internal        |
| **Web UI**              | Inbound       | HTTPS + WSS                           | 443 (via Caddy) |

**Key insight:** Only ports **80** and **443** need to be open inbound. All other traffic is outbound or internal.

---

## Prerequisites

Before starting, you need:

- [ ] **Azure account** with permissions to create VMs and DNS zones
- [ ] **Azure CLI** installed locally (`az` command) — [Install guide](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)
- [ ] **Domain name** — two A records will point to the VM (e.g., `athena.sonance.com`, `cortex.sonance.com`)
- [ ] **Supabase project** — with URL, anon key, and service role key
- [ ] **Anthropic API key** — for the AI proxy (Apollo)
- [ ] **Channel bot tokens** (whichever channels you want to enable):
  - Telegram: bot token from [@BotFather](https://t.me/BotFather)
  - Discord: bot token from [Discord Developer Portal](https://discord.com/developers/applications)
  - Slack: bot token + app token from [Slack API](https://api.slack.com/apps)
  - Teams: app ID + password from [Azure Bot Framework](https://dev.botframework.com)
- [ ] **Git access** to the Athena and Cortex repositories

---

## Step 1 — Provision Azure VM

```bash
# Login to Azure
az login

# Create resource group
az group create \
  --name rg-athena-prod \
  --location westus2

# Create the VM
az vm create \
  --resource-group rg-athena-prod \
  --name vm-athena-prod \
  --image Canonical:ubuntu-24_04-lts:server:latest \
  --size Standard_D4s_v5 \
  --admin-username azureuser \
  --generate-ssh-keys \
  --os-disk-size-gb 64 \
  --storage-sku Premium_LRS \
  --public-ip-sku Standard

# Open ports 80 and 443 for HTTPS traffic
az network nsg rule create \
  --resource-group rg-athena-prod \
  --nsg-name vm-athena-prodNSG \
  --name AllowHTTP \
  --priority 100 \
  --destination-port-ranges 80 443 \
  --protocol Tcp \
  --access Allow

# Get the public IP address
az vm show -d \
  --resource-group rg-athena-prod \
  --name vm-athena-prod \
  --query publicIps \
  --output tsv
```

Save the public IP address — you'll need it for DNS.

---

## Step 2 — Configure DNS

Create A records pointing to your VM's public IP:

| Record               | Type | Value            |
| -------------------- | ---- | ---------------- |
| `athena.sonance.com` | A    | `<VM_PUBLIC_IP>` |
| `cortex.sonance.com` | A    | `<VM_PUBLIC_IP>` |

If using Azure DNS:

```bash
# Create DNS zone (if not already existing)
az network dns zone create \
  --resource-group rg-athena-prod \
  --name sonance.com

# Add A records
az network dns record-set a add-record \
  --resource-group rg-athena-prod \
  --zone-name sonance.com \
  --record-set-name athena \
  --ipv4-address <VM_PUBLIC_IP>

az network dns record-set a add-record \
  --resource-group rg-athena-prod \
  --zone-name sonance.com \
  --record-set-name cortex \
  --ipv4-address <VM_PUBLIC_IP>
```

Wait for DNS propagation (usually 1-5 minutes). Verify:

```bash
dig athena.sonance.com +short
dig cortex.sonance.com +short
```

---

## Step 3 — Install Docker on the VM

```bash
# SSH into the VM
ssh azureuser@<VM_PUBLIC_IP>

# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (avoids sudo for docker commands)
sudo usermod -aG docker azureuser

# Log out and back in for group membership to take effect
exit
ssh azureuser@<VM_PUBLIC_IP>

# Verify Docker
docker --version
docker compose version
```

---

## Step 4 — Clone Repositories

```bash
# Create the deployment directory
sudo mkdir -p /opt/athena
sudo chown azureuser:azureuser /opt/athena
cd /opt/athena

# Clone both repos
git clone <ATHENA_REPO_URL> Athena
git clone <CORTEX_REPO_URL> Cortex

# Checkout the staging branch (or main)
cd Athena && git checkout staging && cd ..
cd Cortex && git checkout main && cd ..

# Create the deploy directory
mkdir -p deploy
```

---

## Step 5 — Create Cortex Dockerfile

Cortex does not have a Dockerfile yet. Create one:

```bash
cat > /opt/athena/Cortex/core/Dockerfile << 'DOCKERFILE'
FROM python:3.12-slim-bookworm

WORKDIR /app

# System dependencies for Python packages (cryptography, etc.)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml ./
RUN pip install --no-cache-dir . && \
    pip install --no-cache-dir cryptography

# Copy application code
COPY . .

# Security: run as non-root
RUN useradd -m cortex
USER cortex

EXPOSE 8000

# Run with 2 uvicorn workers for concurrency
CMD ["uvicorn", "cortex.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
DOCKERFILE
```

> **Note:** The `cryptography` package is required by Cortex's Fernet encryption module (`cortex/shared/encryption.py`) for encrypting OAuth tokens, but is missing from `pyproject.toml`. It's installed explicitly here until it's added to the project dependencies.

---

## Step 6 — Create Docker Compose File

```bash
cat > /opt/athena/deploy/docker-compose.prod.yml << 'COMPOSE'
services:
  # =========================================================================
  # Caddy — Reverse Proxy with Automatic TLS
  # =========================================================================
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped
    depends_on:
      athena-gateway:
        condition: service_healthy
      cortex:
        condition: service_healthy
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"

  # =========================================================================
  # Athena Gateway — Agent + Channel Hub
  # =========================================================================
  athena-gateway:
    build:
      context: ../Athena
      dockerfile: Dockerfile
    environment:
      HOME: /home/node
      NODE_ENV: production
      OPENCLAW_STATE_DIR: /data
      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN}
      # Cortex connection (Docker internal network)
      SONANCE_CORTEX_API_URL: http://cortex:8000
      SONANCE_CORTEX_API_KEY: ${SONANCE_CORTEX_API_KEY}
      SONANCE_APOLLO_BASE_URL: http://cortex:8000
      SONANCE_MCP_BRIDGE_URL: http://cortex:8000/mcp/cortex
      # Telegram
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
      # Discord
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN:-}
      # Slack
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN:-}
      SLACK_APP_TOKEN: ${SLACK_APP_TOKEN:-}
      # MS Teams
      MSTEAMS_APP_ID: ${MSTEAMS_APP_ID:-}
      MSTEAMS_APP_PASSWORD: ${MSTEAMS_APP_PASSWORD:-}
    volumes:
      - athena_data:/data
    command: >
      node dist/index.js gateway
      --allow-unconfigured
      --bind lan
      --port 18789
    init: true
    restart: unless-stopped
    healthcheck:
      test: >
        node -e "
          fetch('http://localhost:18789/health')
            .then(r => process.exit(r.ok ? 0 : 1))
            .catch(() => process.exit(1))
        "
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"

  # =========================================================================
  # Cortex API — Backend Platform
  # =========================================================================
  cortex:
    build:
      context: ../Cortex/core
      dockerfile: Dockerfile
    environment:
      CORTEX_APP_ENV: production
      CORTEX_LOG_LEVEL: INFO
      # Supabase
      CORTEX_SUPABASE_URL: ${CORTEX_SUPABASE_URL}
      CORTEX_SUPABASE_ANON_KEY: ${CORTEX_SUPABASE_ANON_KEY}
      CORTEX_SUPABASE_SERVICE_ROLE_KEY: ${CORTEX_SUPABASE_SERVICE_ROLE_KEY}
      SUPABASE_JWT_SECRET: ${SUPABASE_JWT_SECRET}
      # Anthropic (for Apollo AI proxy)
      CORTEX_ANTHROPIC_API_KEY: ${CORTEX_ANTHROPIC_API_KEY}
      # Encryption key for storing OAuth tokens
      CORTEX_ENCRYPTION_KEY: ${CORTEX_ENCRYPTION_KEY:-}
      # CORS — allow gateway and external dashboard access
      CORTEX_CORS_ORIGINS: '["https://athena.sonance.com","http://localhost:18789"]'
      # Optional integrations
      CORTEX_GITHUB_PAT: ${CORTEX_GITHUB_PAT:-}
      CORTEX_VERCEL_TOKEN: ${CORTEX_VERCEL_TOKEN:-}
      CORTEX_SUPABASE_ACCESS_TOKEN: ${CORTEX_SUPABASE_ACCESS_TOKEN:-}
      # Optional: Okta SSO
      CORTEX_OKTA_DOMAIN: ${CORTEX_OKTA_DOMAIN:-}
      CORTEX_OKTA_CLIENT_ID: ${CORTEX_OKTA_CLIENT_ID:-}
      # Optional: AD employee sync
      CORTEX_AD_SUPABASE_URL: ${CORTEX_AD_SUPABASE_URL:-}
      CORTEX_AD_SUPABASE_SERVICE_ROLE_KEY: ${CORTEX_AD_SUPABASE_SERVICE_ROLE_KEY:-}
    restart: unless-stopped
    healthcheck:
      test: >
        python -c "
          import urllib.request;
          urllib.request.urlopen('http://localhost:8000/health')
        "
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"

  # =========================================================================
  # Optional: Signal CLI daemon (uncomment if Signal channel needed)
  # =========================================================================
  # signal-cli:
  #   image: bbernhard/signal-cli-rest-api:latest
  #   environment:
  #     MODE: json-rpc
  #   volumes:
  #     - signal_data:/home/.local/share/signal-cli
  #   restart: unless-stopped

volumes:
  athena_data:
  caddy_data:
  caddy_config:
  # signal_data:
COMPOSE
```

---

## Step 7 — Create Caddyfile

```bash
cat > /opt/athena/deploy/Caddyfile << 'CADDYFILE'
# Athena Gateway — Web UI, WebSocket, Telegram/Slack webhooks
athena.sonance.com {
    # Teams Bot Framework webhook (routed to separate internal port)
    handle /api/messages* {
        reverse_proxy athena-gateway:3978
    }

    # Everything else: Web UI, WebSocket, health check, channel webhooks
    reverse_proxy athena-gateway:18789
}

# Cortex API — REST endpoints, Apollo proxy, MCP bridge
cortex.sonance.com {
    reverse_proxy cortex:8000
}
CADDYFILE
```

Replace `athena.sonance.com` and `cortex.sonance.com` with your actual domain names.

---

## Step 8 — Configure Environment Variables

```bash
cat > /opt/athena/deploy/.env << 'ENV'
# =============================================================================
# REQUIRED — Athena Gateway
# =============================================================================

# Random token for gateway authentication (generate with: openssl rand -hex 32)
OPENCLAW_GATEWAY_TOKEN=CHANGE_ME

# Cortex API key (create one via Cortex API or Supabase dashboard)
SONANCE_CORTEX_API_KEY=ctx_CHANGE_ME

# =============================================================================
# REQUIRED — Cortex
# =============================================================================

# Supabase connection
CORTEX_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
CORTEX_SUPABASE_ANON_KEY=eyJ...
CORTEX_SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=YOUR_JWT_SECRET

# Anthropic API key (used by Apollo proxy)
CORTEX_ANTHROPIC_API_KEY=sk-ant-...

# Fernet encryption key for OAuth token storage
# Generate with: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
CORTEX_ENCRYPTION_KEY=CHANGE_ME

# =============================================================================
# CHANNEL TOKENS (set only the channels you want to enable)
# =============================================================================

# Telegram (from @BotFather)
TELEGRAM_BOT_TOKEN=

# Discord (from Discord Developer Portal)
DISCORD_BOT_TOKEN=

# Slack (from Slack API — Socket Mode recommended)
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...

# MS Teams (from Azure Bot Framework registration)
MSTEAMS_APP_ID=
MSTEAMS_APP_PASSWORD=

# =============================================================================
# OPTIONAL — Integrations
# =============================================================================

# GitHub PAT (for GitHub MCP connection)
CORTEX_GITHUB_PAT=ghp_...

# Vercel token (for Vercel MCP connection)
CORTEX_VERCEL_TOKEN=

# Supabase management token (for Supabase MCP connection)
CORTEX_SUPABASE_ACCESS_TOKEN=

# Okta SSO (for employee authentication)
CORTEX_OKTA_DOMAIN=
CORTEX_OKTA_CLIENT_ID=

# AD employee sync (separate Supabase project with employee directory)
CORTEX_AD_SUPABASE_URL=
CORTEX_AD_SUPABASE_SERVICE_ROLE_KEY=
ENV
```

Edit the file and fill in your actual values:

```bash
nano /opt/athena/deploy/.env
```

Generate the required secrets:

```bash
# Generate gateway token
openssl rand -hex 32

# Generate Fernet encryption key (requires Python + cryptography)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

---

## Step 9 — Configure Athena Gateway

The Athena gateway config lives at `/data/athena.json` inside the container (mapped to the `athena_data` Docker volume). On first startup, the gateway creates a default config. After first boot, you can edit it.

To pre-seed the config before first boot:

```bash
# Create the volume mount point and config
docker volume create athena_data

# Find the volume path
ATHENA_VOL=$(docker volume inspect athena_data --format '{{ .Mountpoint }}')

# Create the config (run as root since Docker volumes are root-owned)
sudo cat > ${ATHENA_VOL}/athena.json << 'CONFIG'
{
  "gateway": {
    "auth": {
      "mode": "none"
    }
  },
  "plugins": {
    "deny": [],
    "entries": {
      "sonance-cortex": {
        "enabled": true,
        "config": {
          "apiBaseUrl": "http://cortex:8000",
          "apolloBaseUrl": "http://cortex:8000",
          "mcpBridgeUrl": "http://cortex:8000/mcp/cortex"
        }
      }
    }
  },
  "channels": {
    "telegram": {
      "dmPolicy": "open"
    }
  }
}
CONFIG
```

> **Critical:** Setting `"plugins": { "deny": [] }` overrides the default Sonance channel denylist. Without this, all messaging channels are blocked. See [Step 10](#step-10--enable-messaging-channels) for details.

---

## Step 10 — Enable Messaging Channels

By default, the Sonance fork of Athena **blocks all messaging channels** via `SONANCE_DENIED_CHANNEL_PLUGINS` in `src/config/sonance-defaults.ts`. This is a safety measure for local development.

For production, you must explicitly override this by setting `"plugins": { "deny": [] }` in the gateway config (shown in Step 9). The `applySonanceDefaults()` function merges the denylist, but an explicit empty array in the config takes precedence during config resolution.

> **If channels still don't load after setting `deny: []`:** The `applySonanceDefaults()` function at line 49 unconditionally merges `SONANCE_DENIED_CHANNEL_PLUGINS` into the deny list. A code change may be needed to make it respect explicit user overrides. See the [Code Change Required](#code-change--sonance-defaultsts) section below.

### Code Change — `sonance-defaults.ts`

**File:** `src/config/sonance-defaults.ts`

Change the deny list merging logic so explicit user config overrides the defaults:

```typescript
// BEFORE (line 47-49):
const existingDeny = Array.isArray(plugins.deny) ? (plugins.deny as string[]) : [];
const mergedDeny = Array.from(new Set([...existingDeny, ...SONANCE_DENIED_CHANNEL_PLUGINS]));

// AFTER:
const hasExplicitDeny = Array.isArray(plugins.deny);
const existingDeny = hasExplicitDeny ? (plugins.deny as string[]) : [];
const mergedDeny = hasExplicitDeny
  ? existingDeny // User explicitly set deny list — respect it
  : Array.from(new Set([...existingDeny, ...SONANCE_DENIED_CHANNEL_PLUGINS]));
```

This way:

- **Local dev (no deny in config):** All channels stay blocked (default behavior unchanged)
- **Production (`"deny": []` in config):** All channels enabled
- **Selective (`"deny": ["signal","whatsapp"]`):** Only listed channels blocked

---

## Step 11 — Deploy

```bash
cd /opt/athena/deploy

# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Watch logs during first startup
docker compose -f docker-compose.prod.yml logs -f
```

First startup takes 5-10 minutes for Docker to build both images. Subsequent restarts are near-instant.

---

## Step 12 — Verify Deployment

```bash
# 1. Health checks
curl -s https://athena.sonance.com/health | jq .
# Expected: {"status":"healthy","version":"1.0.0","service":"cortex-api"}

curl -s https://cortex.sonance.com/health | jq .
# Expected: {"status":"healthy","version":"1.0.0","service":"cortex-api"}

# 2. Check container status
docker compose -f docker-compose.prod.yml ps

# 3. Check logs for errors
docker compose -f docker-compose.prod.yml logs athena-gateway --tail 50
docker compose -f docker-compose.prod.yml logs cortex --tail 50

# 4. Test Telegram (send a message to your bot)
# The bot should respond within a few seconds

# 5. Test Web UI
# Open https://athena.sonance.com in a browser
# The SonanceClaw dashboard should load
```

---

## Channel-Specific Setup

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Set `TELEGRAM_BOT_TOKEN` in `.env`
3. **Polling mode (default):** No additional setup needed — the gateway polls Telegram
4. **Webhook mode (optional):** Add to `athena.json`:
   ```json
   "channels": {
     "telegram": {
       "webhookUrl": "https://athena.sonance.com/telegram-webhook",
       "webhookSecret": "your-random-secret",
       "dmPolicy": "open"
     }
   }
   ```

### Microsoft Teams

1. Register a bot in the [Azure Bot Framework](https://portal.azure.com/#create/Microsoft.AzureBot)
2. Set the messaging endpoint to: `https://athena.sonance.com/api/messages`
3. Set `MSTEAMS_APP_ID` and `MSTEAMS_APP_PASSWORD` in `.env`
4. Install the bot in your Teams tenant

### Discord

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot under the application, copy the token
3. Set `DISCORD_BOT_TOKEN` in `.env`
4. Invite the bot to your server with appropriate permissions
5. Discord uses an outbound WebSocket — no webhook URL needed

### Slack

1. Create an app at [Slack API](https://api.slack.com/apps)
2. Enable **Socket Mode** (recommended — no public URL needed)
3. Generate an app-level token (connections:write scope)
4. Set `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env`
5. Subscribe to events: `message.im`, `message.channels`, `app_mention`

### Signal

1. Uncomment the `signal-cli` service in `docker-compose.prod.yml`
2. Register a phone number with signal-cli
3. Configure Athena to connect to the signal-cli daemon:
   ```json
   "channels": {
     "signal": {
       "httpHost": "signal-cli",
       "httpPort": 8080,
       "account": "+1234567890"
     }
   }
   ```

---

## Monitoring and Operations

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f athena-gateway
docker compose -f docker-compose.prod.yml logs -f cortex
docker compose -f docker-compose.prod.yml logs -f caddy
```

### Restart Services

```bash
# Restart a specific service
docker compose -f docker-compose.prod.yml restart athena-gateway

# Restart all services
docker compose -f docker-compose.prod.yml restart
```

### Update Athena

```bash
cd /opt/athena/Athena
git pull

cd /opt/athena/deploy
docker compose -f docker-compose.prod.yml build athena-gateway
docker compose -f docker-compose.prod.yml up -d athena-gateway
```

### Update Cortex

```bash
cd /opt/athena/Cortex
git pull

cd /opt/athena/deploy
docker compose -f docker-compose.prod.yml build cortex
docker compose -f docker-compose.prod.yml up -d cortex
```

### Metrics to Monitor

| Metric             | Source          | Alert When            |
| ------------------ | --------------- | --------------------- |
| VM CPU             | Azure Monitor   | > 80% sustained 5 min |
| VM Memory          | Azure Monitor   | > 85%                 |
| Disk usage         | Azure Monitor   | > 80%                 |
| Container restarts | `docker events` | > 3 in 1 hour         |
| Athena health      | `curl /health`  | Non-200 response      |
| Cortex health      | `curl /health`  | Non-200 response      |
| API error rate     | Cortex logs     | > 10 errors/minute    |

### Set Up Azure Monitor Alerts (Optional)

```bash
# CPU alert
az monitor metrics alert create \
  --resource-group rg-athena-prod \
  --name "HighCPU" \
  --scopes $(az vm show -g rg-athena-prod -n vm-athena-prod --query id -o tsv) \
  --condition "avg Percentage CPU > 80" \
  --window-size 5m \
  --evaluation-frequency 1m

# Memory alert (requires Azure Monitor Agent)
# Follow: https://learn.microsoft.com/en-us/azure/azure-monitor/vm/monitor-virtual-machine
```

---

## Backup Strategy

| What                                       | How                                                        | Frequency  |
| ------------------------------------------ | ---------------------------------------------------------- | ---------- |
| Athena session data (`athena_data` volume) | Azure disk snapshot or `docker cp` + rsync to Blob Storage | Daily      |
| Supabase database                          | Automatic (Supabase manages backups)                       | Continuous |
| VM OS disk                                 | Azure disk snapshot                                        | Weekly     |
| `.env` and config files                    | Copy to Azure Key Vault or encrypted blob                  | On change  |

```bash
# Manual backup of Athena data volume
docker run --rm -v athena_data:/data -v /opt/athena/backups:/backup \
  alpine tar czf /backup/athena-data-$(date +%Y%m%d).tar.gz -C /data .
```

---

## Troubleshooting

### Channels not loading

**Symptom:** Gateway starts but no channels connect.
**Cause:** `SONANCE_DENIED_CHANNEL_PLUGINS` blocks all channels by default.
**Fix:** Ensure `athena.json` has `"plugins": { "deny": [] }` and apply the code change in Step 10.

### Teams messages not arriving

**Symptom:** Teams bot appears online but doesn't respond.
**Cause:** Azure Bot Framework can't reach the webhook endpoint.
**Fix:** Verify:

1. `curl -I https://athena.sonance.com/api/messages` returns 200 or 405 (not 502)
2. The bot's messaging endpoint in Azure Portal is `https://athena.sonance.com/api/messages`
3. `MSTEAMS_APP_ID` and `MSTEAMS_APP_PASSWORD` are correct

### Cortex 401 errors

**Symptom:** Athena logs show `Cortex API error: 401 Unauthorized`
**Cause:** API key mismatch between Athena and Cortex.
**Fix:** Ensure `SONANCE_CORTEX_API_KEY` in the Athena container matches a valid key in the Cortex `api_keys` Supabase table.

### SSL certificate not provisioning

**Symptom:** Browser shows certificate error.
**Cause:** Caddy can't reach ACME servers, or DNS not propagated.
**Fix:**

1. Verify DNS: `dig athena.sonance.com +short` should return your VM IP
2. Check Caddy logs: `docker compose logs caddy`
3. Ensure ports 80 and 443 are open in the NSG

### Container keeps restarting

**Symptom:** `docker compose ps` shows a service restarting.
**Fix:** Check the logs: `docker compose logs <service-name> --tail 100`

---

## Future Scaling Path

| Users        | Infrastructure                             | Key Changes                                                                                                      |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **< 200**    | Single D4s_v5 VM (current plan)            | None needed                                                                                                      |
| **200-500**  | Upgrade to D8s_v5 (8 vCPU, 32 GB)          | Add Redis for Cortex rate limiting (`CORTEX_AI_RATE_LIMIT_BACKEND=redis`)                                        |
| **500-1000** | Azure Container Apps (2-3 Athena replicas) | Move session storage from disk to Redis/PostgreSQL. Add sticky sessions for WebSocket.                           |
| **1000+**    | AKS cluster with HPA                       | Leader election for channel connections (one bot per channel). Horizontal pod autoscaling. Dedicated node pools. |

**For multi-instance Athena, these changes are required:**

1. Session storage: replace disk JSON (`~/.openclaw/sessions/`) with Redis or PostgreSQL
2. Channel multiplexing: only ONE instance should run each channel bot — use leader election
3. WebSocket affinity: sticky sessions via load balancer cookie
4. Dedup map: move from in-memory to Redis pub/sub

---

## Cost Estimate

| Resource                             | Monthly Cost          |
| ------------------------------------ | --------------------- |
| Standard_D4s_v5 VM (pay-as-you-go)   | ~$140                 |
| Standard_D4s_v5 VM (1-year reserved) | ~$88                  |
| 64 GB Premium SSD (P6)               | ~$5                   |
| Bandwidth (outbound, ~100 GB)        | ~$9                   |
| Supabase (Pro plan)                  | $25                   |
| Anthropic API (usage-based)          | Varies                |
| **Total (reserved VM)**              | **~$127 + API costs** |
