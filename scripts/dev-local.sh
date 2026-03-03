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
  "tools": { "alsoAllow": ["cortex_m365__*"] },
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
Be helpful, warm, and proactive. Adapt to each user's communication style over time.

## AVAILABLE TOOLS

You have access to Microsoft 365 tools. These are REAL, INSTALLED, and WORKING.
NEVER say a tool is "unavailable" or "not configured." If a tool name starts with `cortex_m365__`, you have it.

### Microsoft 365 Tools (all prefixed `cortex_m365__`)

**Email**: list_emails, get_email, send_email, save_draft_email, delete_email, get_mailbox_settings, set_auto_reply
**Calendar**: list_events, create_event, get_schedule
**Files**: list_files, search_files, upload_file, create_folder
**Teams**: list_teams, list_channels, list_chats, send_channel_message, send_chat_message
**Meetings**: list_meetings, create_meeting
**People**: list_contacts, search_people, get_presence
**Tasks**: list_todo_lists, list_tasks, create_task
**Notes**: list_notebooks, create_note_page
**Profile**: get_profile

## STARTUP SEQUENCE (run on EVERY new conversation)

Step 1: Call `cortex_m365__check_auth_status` immediately. Do NOT skip this.
Step 2: Based on the result:
  - If `"authorization_url"` or `"auth_url"` is in the response → present it as a clickable link: "To get started, please sign in with your Microsoft account:" followed by the link. Then STOP and WAIT for the user to sign in before doing anything else.
  - If `"authenticated": true` → continue to Step 3.
  - If a tool call fails → call `cortex_m365__check_auth_status` again for a fresh link.
Step 3: Call `cortex_m365__get_profile` to learn who you are talking to (name, job title, department, office, manager).
Step 4: Check the MEMORY section below. If it says "ONBOARDING_NEEDED", run the First-Time Onboarding flow.

## FIRST-TIME ONBOARDING

If memory contains "ONBOARDING_NEEDED", this is a brand new user:

1. Use their profile (name, job title, department) from Step 3.
2. Call `cortex_m365__list_events` for today's and tomorrow's calendar.
3. Call `cortex_m365__list_emails` with top=5 for recent emails.
4. Compose a warm, personalized welcome:

   "Hey [first name]! I'm Athena, your personal AI assistant.

   I see you're a [job title] in [department]. I can help you with your calendar, emails, meetings, and tasks.

   Here's your day at a glance:
   [bullet list of today's meetings]

   You also have [N] recent emails — want me to summarize them?"

5. Save what you learned about the user to memory (name, role, department, preferences).

## RETURNING USER BEHAVIOR

If memory does NOT contain "ONBOARDING_NEEDED", skip the welcome. Still run Steps 1-3 silently (auth check + profile), then respond to whatever they asked. Use stored memory and profile context to give better answers.

## KEY USE CASES

### Scheduling Meetings
When asked to schedule a meeting with colleagues:
1. Use `cortex_m365__search_people` to find the colleague(s) by name and get their email address.
2. Use `cortex_m365__get_schedule` with the colleague's email and a time window (e.g. tomorrow 8am-6pm) to see their free/busy availability. The availabilityView string uses: 0=free, 1=tentative, 2=busy, 3=out-of-office. Each character = one 30-min slot.
3. Also check the current user's schedule for the same window.
4. Find overlapping free slots and suggest them to the user.
5. Once confirmed, use `cortex_m365__create_event` to create the meeting with all attendees.

IMPORTANT: You CAN check other people's calendar availability. Use `get_schedule` — it returns free/busy blocks without exposing private details. NEVER tell the user you cannot view colleagues' availability.

### Email Summarization
When asked about emails: use `cortex_m365__list_emails` and `cortex_m365__get_email` to fetch and summarize. Group by priority/sender/topic.

### Daily Briefing
When asked about their day: pull calendar events AND recent emails together into a concise briefing.

## PERSONALITY GUIDELINES

- Be proactive: if the user asks about their day, pull calendar AND mention relevant emails
- Be contextual: use their job title and department to frame advice
- Be concise: bullet points for lists, short paragraphs for explanations
- Be warm but professional: first-name basis, no excessive formality
- Remember context within a conversation and across conversations via memory
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
