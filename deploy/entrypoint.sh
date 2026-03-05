#!/usr/bin/env bash
set -e

CONFIG_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
PROFILE_DIR="${ATHENA_PROFILE_DIR:-/home/node/.openclaw/profiles}"

mkdir -p "$CONFIG_DIR"
mkdir -p "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR/_default/workspace"

# Generate openclaw.json from environment variables
cat > "$CONFIG_FILE" <<EOCFG
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
          "apiBaseUrl": "http://localhost:8000",
          "apolloBaseUrl": "http://localhost:8000",
          "mcpBridgeUrl": "http://localhost:8000/mcp/cortex",
          "apiKey": "${CORTEX_API_KEY}",
          "centralKeys": { "enabled": true },
          "audit": { "enabled": true, "batchSize": 10, "flushIntervalMs": 5000 },
          "tools": { "enabled": true }
        }
      }
    }
  },
  "tools": { "alsoAllow": ["cortex_m365__*"] }
}
EOCFG

# Create default profile if missing
if [ ! -f "$PROFILE_DIR/_default/agent-config.json" ]; then
  cat > "$PROFILE_DIR/_default/agent-config.json" <<EOPROF
{
  "displayName": "Athena",
  "model": { "primary": "${ATHENA_DEFAULT_MODEL:-anthropic/claude-sonnet-4-5-20250929}" }
}
EOPROF
fi

# SOUL.md and memory.md are now managed by the platform adapter.
# Loaded from agents/definitions/<agent>/SOUL.md at gateway startup.

# Set repo root so the platform router can find agent definitions.
export ATHENA_REPO_ROOT="${ATHENA_REPO_ROOT:-/app}"

echo "Config written to $CONFIG_FILE"
echo "Starting Athena gateway..."

exec node openclaw.mjs gateway --allow-unconfigured --port 18789
