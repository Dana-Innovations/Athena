Athena (SonanceClaw) — Developer Setup Guide

This guide walks through setting up the Athena gateway from a fresh clone of the `staging` branch. Follow every step in order.

---

## Prerequisites

- **Node.js 22+**
- **pnpm** (install via `npm install -g pnpm` if missing)
- **Cortex server running** at a known URL (default: `http://localhost:8000`)
- **Cortex API key** (starts with `ctx_...`) — ask Josh if you don't have one

---

## 1. Clone & Checkout

```bash
git clone https://github.com/Dana-Innovations/Athena.git
cd Athena
git checkout staging
```

If you already have the repo cloned:

```bash
git fetch origin
git checkout staging
git pull origin staging
```

---

## 2. Install Dependencies

```bash
pnpm install
```

This reads `pnpm-lock.yaml` and installs all workspace packages including `extensions/sonance-cortex`.

---

## 3. Build Everything

Two build steps are required — the core gateway and the UI:

```bash
pnpm build       # compiles TypeScript → dist/entry.js
pnpm ui:build    # bundles the web dashboard → ui/dist/
```

Both must succeed before running the gateway. If `pnpm build` fails with TypeScript errors, fix them before proceeding.

---

## 4. Create the Local Configuration File

The gateway reads its configuration from `~/.athena/openclaw.json`. **This file is NOT in git** — each developer needs their own copy.

Create the directory and file:

```bash
mkdir -p ~/.athena
```

Then create `~/.athena/openclaw.json` with the following contents. Replace the placeholder values with your actual Cortex details:

```json
{
  "gateway": {
    "mode": "local",
    "auth": {
      "mode": "none"
    }
  },
  "models": {
    "providers": {
      "anthropic": {
        "baseUrl": "http://localhost:8000",
        "api": "anthropic-messages",
        "models": [
          { "id": "claude-sonnet-4-5-20250929", "name": "Claude Sonnet 4.5" },
          { "id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5-20250929"
      }
    }
  },
  "plugins": {
    "entries": {
      "sonance-cortex": {
        "enabled": true,
        "config": {
          "apiBaseUrl": "http://localhost:8000",
          "apolloBaseUrl": "http://localhost:8000",
          "mcpBridgeUrl": "http://localhost:8000/mcp/cortex",
          "apiKey": "YOUR_CORTEX_API_KEY_HERE",
          "mcpServers": [
            {
              "name": "m365",
              "command": "npx",
              "args": ["-y", "sonance-m365-mcp"],
              "registerTools": true
            }
          ]
        }
      }
    }
  }
}
```

### Configuration Fields Explained

| Field                                                 | Purpose                                               |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `gateway.mode`                                        | `"local"` for local development                       |
| `gateway.auth.mode`                                   | `"none"` disables auth for local PoC                  |
| `models.providers.anthropic.baseUrl`                  | Points to the Apollo proxy so AI requests are tracked |
| `plugins.entries.sonance-cortex.config.apiBaseUrl`    | Cortex API server URL                                 |
| `plugins.entries.sonance-cortex.config.apolloBaseUrl` | Apollo usage-tracking proxy URL                       |
| `plugins.entries.sonance-cortex.config.mcpBridgeUrl`  | CompositeMCPBridge endpoint for tool discovery        |
| `plugins.entries.sonance-cortex.config.apiKey`        | Your Cortex API key (`ctx_...`)                       |
| `plugins.entries.sonance-cortex.config.mcpServers`    | External MCP servers to bridge (e.g. M365)            |

> **Important:** If `apiBaseUrl` and `apolloBaseUrl` both point to `localhost:8000`, make sure the Cortex server is running on that port before starting the gateway.

---

## 5. Set the Anthropic API Key

The Apollo proxy forwards requests to Anthropic. The Cortex server needs a valid Anthropic key configured on its side. For local dev, you may also need it in your environment:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Add this to your shell profile (`~/.zshrc` or `~/.bashrc`) to persist it.

> If your Cortex instance handles key resolution centrally (via `centralKeys.enabled: true` in the plugin config), you may not need this locally.

---

## 6. Run the Gateway

```bash
pnpm openclaw gateway run --port 18789
```

Once it starts, open the dashboard in your browser:

```
http://127.0.0.1:18789
```

You should see the **SonanceClaw Gateway Dashboard**.

---

## 7. Verify Everything Works

### Dashboard loads

- Open `http://127.0.0.1:18789` — you should see the SonanceClaw sidebar and dashboard.

### Apollo usage tracking

- Go to the **Apollo** page in the sidebar.
- Send a test message via the Athena chat (also in the sidebar).
- Apollo should show the request within 30 seconds (it auto-polls).

### Agents / MCP tools

- Go to the **Agents** page in the sidebar.
- You should see agent groups (e.g. M365, Jira, Slack, etc.) populated from the Cortex MCP bridge.
- If agents are missing, check the gateway terminal for errors like `401 Authentication required` (API key issue) or `404 Not Found` (endpoint issue).

---

## Troubleshooting

| Symptom                             | Likely Cause                                | Fix                                                                       |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `command not found: openclaw`       | Dependencies not installed                  | Run `pnpm install`                                                        |
| UI shows old/broken layout          | UI not rebuilt                              | Run `pnpm ui:build`                                                       |
| Apollo shows "No requests recorded" | Cortex not running or wrong `apolloBaseUrl` | Verify Cortex is running at the configured URL                            |
| Agents page empty                   | Wrong API key or `mcpBridgeUrl`             | Check `apiKey` and `mcpBridgeUrl` in config                               |
| Gateway won't start (port in use)   | Old process still running                   | `lsof -ti:18789 \| xargs kill -9` then retry                              |
| TypeScript build errors             | Source out of sync                          | `git pull origin staging && pnpm build`                                   |
| Gateway restart loop                | Config watcher triggered                    | Check gateway logs; ensure `openclaw.json` isn't being written repeatedly |

---

## After Pulling New Code

Whenever you pull updates from `staging`:

```bash
git pull origin staging
pnpm install        # in case dependencies changed
pnpm build          # recompile gateway
pnpm ui:build       # rebuild dashboard
# restart the gateway
```

Your `~/.athena/openclaw.json` will NOT be overwritten by pulls — it's local only.
