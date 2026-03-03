#!/usr/bin/env bash
set -euo pipefail

# ─── Athena + Cortex Local Dev ─────────────────────────────────────
# Runs both Cortex (Python) and Athena (Node) locally with an ngrok
# tunnel so Teams messages route to your Mac.
#
# Usage:  ./scripts/dev-local.sh
# Stop:   Ctrl-C  (restores Azure endpoint automatically)
# ───────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/.env"
CORTEX_DIR="${CORTEX_DIR:-/Users/sonanceguest/Documents/Cortex/Cortex}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi
source "$ENV_FILE"

PORT="${LOCAL_PORT:-18789}"
CORTEX_PORT=8000
BOT="${BOT_NAME:?Set BOT_NAME in deploy/.env}"
BOT_RG="${BOT_RESOURCE_GROUP:?Set BOT_RESOURCE_GROUP in deploy/.env}"
AZURE_ENDPOINT="https://${AZURE_FQDN:?Set AZURE_FQDN in deploy/.env}/api/messages"

# ─── Cleanup: restore Azure endpoint on exit ──────────────────────
cleanup() {
  echo ""
  echo "==> Shutting down..."
  az bot update --name "$BOT" --resource-group "$BOT_RG" \
    --endpoint "$AZURE_ENDPOINT" -o none 2>/dev/null || true
  echo "    Bot endpoint restored to Azure"
  [[ -n "${NGROK_PID:-}" ]] && kill -9 "$NGROK_PID" 2>/dev/null || true
  [[ -n "${CORTEX_PID:-}" ]] && kill -9 "$CORTEX_PID" 2>/dev/null || true
  pkill -9 -f "openclaw gateway" 2>/dev/null || true
  pkill -9 -f ngrok 2>/dev/null || true
  echo "==> Done."
}
trap cleanup EXIT INT TERM

# ─── 1. Start Cortex locally ─────────────────────────────────────
echo "==> Starting Cortex on port $CORTEX_PORT..."
if [[ ! -d "$CORTEX_DIR/core/.venv" ]]; then
  echo "ERROR: Cortex venv not found at $CORTEX_DIR/core/.venv"
  echo "Run: cd $CORTEX_DIR/core && python3 -m venv .venv && pip install -e '.[dev]'"
  exit 1
fi

(
  cd "$CORTEX_DIR/core"
  # Override api_base_url so OAuth callbacks point at Vercel (publicly
  # reachable) while the tool-execution API runs locally.
  export CORTEX_API_BASE_URL="https://cortex-bice.vercel.app"
  # Limit enabled MCPs to keep tool count low (fewer = faster LLM responses).
  if [[ "${CORTEX_MCPS:-}" != "all" && -n "${CORTEX_MCPS:-}" ]]; then
    export CORTEX_MCPS_ENABLED="$CORTEX_MCPS"
  fi
  .venv/bin/python -m uvicorn cortex.main:app \
    --host 127.0.0.1 --port "$CORTEX_PORT" \
    --log-level info \
    > /tmp/cortex-local.log 2>&1
) &
CORTEX_PID=$!
echo "    Cortex PID: $CORTEX_PID"

# Wait for Cortex to be ready
for i in {1..30}; do
  if curl -sf http://127.0.0.1:$CORTEX_PORT/health > /dev/null 2>&1; then
    echo "    Cortex ready!"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: Cortex failed to start. Check /tmp/cortex-local.log"
    tail -20 /tmp/cortex-local.log
    exit 1
  fi
  sleep 1
done

# ─── 2. Start ngrok tunnel (for Teams bot) ───────────────────────
echo "==> Starting ngrok tunnel on port 3978..."
pkill -9 -f ngrok 2>/dev/null || true
sleep 2
ngrok http 3978 --log=stdout --log-level=warn > /tmp/ngrok-athena.log 2>&1 &
NGROK_PID=$!

for i in {1..15}; do
  TUNNEL_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(next(x['public_url'] for x in t if x['public_url'].startswith('https')))" 2>/dev/null || true)
  [[ -n "$TUNNEL_URL" ]] && break
  sleep 1
done

if [[ -z "${TUNNEL_URL:-}" ]]; then
  echo "ERROR: ngrok failed to start. Check /tmp/ngrok-athena.log"
  exit 1
fi
echo "    Tunnel: $TUNNEL_URL"

# ─── 3. Update Azure Bot messaging endpoint ──────────────────────
echo "==> Updating Azure Bot endpoint..."
az bot update --name "$BOT" --resource-group "$BOT_RG" \
  --endpoint "${TUNNEL_URL}/api/messages" -o none
echo "    Bot → ${TUNNEL_URL}/api/messages"

# ─── 4. Generate local Athena config (pointing at local Cortex) ──
CONFIG_DIR="$ROOT_DIR/.local-dev"
PROFILE_DIR="$CONFIG_DIR/profiles"
mkdir -p "$PROFILE_DIR/_default/workspace"

cat > "$CONFIG_DIR/openclaw.json" <<EOCFG
{
  "channels": {
    "msteams": {
      "enabled": true,
      "appId": "${MSTEAMS_APP_ID}",
      "appPassword": "${MSTEAMS_APP_PASSWORD}",
      "tenantId": "${MSTEAMS_TENANT_ID}",
      "dmPolicy": "allowlist",
      "allowFrom": [
        "08c78747-6a8d-4dc2-8cc6-b2520ec0baf5",
        "ff94e4a2-6cb4-4a22-8280-9918b7d0b830",
        "3acfd933-4bae-4f2b-99e3-0d3049b3946f",
        "74afb3fb-f9fe-404f-bd17-79873c40d6ee"
      ],
      "groupPolicy": "disabled",
      "replyStyle": "top-level"
    }
  },
  "plugins": {
    "load": {
      "paths": ["$ROOT_DIR/deploy/msteams-plugin"]
    },
    "deny": [
      "telegram", "whatsapp", "discord", "irc", "googlechat",
      "slack", "signal", "imessage", "bluebubbles", "matrix",
      "zalo", "zalouser", "feishu", "line", "nostr",
      "twitch", "mattermost", "nextcloud-talk", "tlon", "voice-call"
    ],
    "entries": {
      "msteams": { "enabled": true },
      "sonance-cortex": {
        "enabled": true,
        "config": {
          "apiBaseUrl": "http://localhost:${CORTEX_PORT}",
          "apolloBaseUrl": "http://localhost:${CORTEX_PORT}",
          "mcpBridgeUrl": "http://localhost:${CORTEX_PORT}/mcp/cortex",
          "apiKey": "${CORTEX_API_KEY}",
          "centralKeys": { "enabled": true },
          "audit": { "enabled": true, "batchSize": 10, "flushIntervalMs": 5000 },
          "tools": { "enabled": true }
        }
      }
    }
  },
  "gateway": {
    "auth": { "mode": "none" }
  },
  "tools": { "alsoAllow": ["cortex_*"] },
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-sonnet-4-5-20250929" },
      "compaction": { "mode": "safeguard" },
      "workspace": "$PROFILE_DIR/_default/workspace"
    }
  }
}
EOCFG

# Default SOUL.md
cat > "$PROFILE_DIR/_default/workspace/SOUL.md" <<'EOSOUL'
You are Athena, a personal AI assistant for Sonance employees.
Be helpful, warm, and proactive.

## AVAILABLE INTEGRATIONS
You have access to a wide range of Cortex-powered tools. These are REAL, INSTALLED, and WORKING.
NEVER say a tool is "unavailable" or "not installed." If a tool name starts with `cortex_`, you have it.

### Tool prefixes and what they do:
- `cortex_m365__*` — Microsoft 365: email, calendar, OneDrive, Teams chat/channels, meetings, contacts, To Do, OneNote, presence, profile
- `cortex_github__*` — GitHub: repos, issues, PRs, reviews, branches, files, labels, search
- `cortex_slack__*` — Slack: messages, channels, users, search, bookmarks, reactions
- `cortex_asana__*` — Asana: projects, tasks, sections, comments, tags, teams, workspaces
- `cortex_salesforce__*` — Salesforce: SOQL queries, records, reports, objects, org limits
- `cortex_monday__*` — Monday.com: boards, items, groups, updates, columns, users
- `cortex_powerbi__*` — Power BI: workspaces, datasets, reports, dashboards, DAX queries
- `cortex_supabase__*` — Supabase: projects, tables, SQL, edge functions, storage, branches
- `cortex_vercel__*` — Vercel: projects, deployments, env vars, domains
- `cortex_bestbuy__*` — Best Buy: product search, SKU lookup, reviews, stores
- `cortex_devserver__*` — Dev servers: start/stop/restart, logs, ports, deps
- `cortex_filesystem__*` — Remote filesystem: read/write/search files and directories

### OAuth-based integrations (M365, GitHub, Asana, Slack, Salesforce, Monday, Power BI)
Some integrations require the user to connect their account via OAuth.
- If a tool call returns an auth error, call the corresponding `check_auth_status` tool (e.g. `cortex_github__check_auth_status` is not available, but `cortex_m365__check_auth_status` is).
- For M365 specifically: if check_auth_status returns an `auth_url`, present it as a clickable link.

## STARTUP SEQUENCE (run on EVERY new conversation)
Step 1: Call `cortex_m365__check_auth_status` immediately. Do NOT skip this.
Step 2: If `"authorization_url"` or `"auth_url"` is in the response → present it as a clickable link. If `"authenticated": true` → continue.
Step 3: Call `cortex_m365__get_profile` to learn who you are talking to.
EOSOUL

cat > "$PROFILE_DIR/_default/workspace/memory.md" <<'EOMEM'
ONBOARDING_NEEDED
EOMEM

echo ""
echo "==> Starting Athena gateway on port $PORT..."
echo ""
echo "    ┌───────────────────────────────────────────────┐"
echo "    │  Cortex:  http://localhost:$CORTEX_PORT              │"
echo "    │  Athena:  http://localhost:$PORT             │"
echo "    │  Tunnel:  $TUNNEL_URL  │"
echo "    │                                               │"
echo "    │  Teams messages → ngrok → your Mac            │"
echo "    │  Cortex logs:  tail -f /tmp/cortex-local.log  │"
echo "    │  Athena logs:  tail -f /tmp/athena-local.log  │"
echo "    │                                               │"
echo "    │  Press Ctrl-C to stop and restore Azure       │"
echo "    └───────────────────────────────────────────────┘"
echo ""

# ─── 5. Kill any stale gateway, then run ──────────────────────────
pkill -9 -f "openclaw-gateway" 2>/dev/null || true
pkill -9 -f "openclaw gateway" 2>/dev/null || true
sleep 1

export OPENCLAW_STATE_DIR="$CONFIG_DIR"
export ATHENA_PROFILE_DIR="$PROFILE_DIR"
export OPENCLAW_GATEWAY_TOKEN="local-dev-$(date +%s)"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

cd "$ROOT_DIR"
exec pnpm openclaw gateway run --allow-unconfigured --bind loopback --port "$PORT"
