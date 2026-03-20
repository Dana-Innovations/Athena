# agent.yaml Field Reference

Full reference for Athena agent definition files (`agents/definitions/<name>/agent.yaml`).

---

## Top-level

```yaml
apiVersion: athena/v1 # Always "athena/v1"
kind: Agent # Always "Agent"
metadata: ...
spec: ...
```

---

## `metadata`

| Field         | Type     | Required | Description                                                                                                                 |
| ------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string   | ✅       | Unique agent ID. Lowercase, letters/numbers/hyphens only. Used as the session key prefix and bus ID.                        |
| `displayName` | string   | ✅       | Human-readable name shown in Teams and the Admin Portal.                                                                    |
| `description` | string   | ✅       | One-sentence description of what this agent does. Shown in the portal and used as context when other agents query this one. |
| `avatar`      | string   | ❌       | Filename of the avatar image (placed in `agents/definitions/<name>/`).                                                      |
| `aliases`     | string[] | ❌       | Teams mention aliases (e.g. `["@scheduler", "@sched"]`).                                                                    |
| `team`        | string   | ❌       | Logical team this agent belongs to. Informational only.                                                                     |
| `owner`       | string   | ❌       | Owner's email address. Shown in the portal.                                                                                 |

---

## `spec`

### `spec.role`

```yaml
spec:
  role: orchestrator # or "specialist"
```

| Value          | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `orchestrator` | Primary user-facing agent. Gets `default: true` in OpenClaw config. Users interact directly. |
| `specialist`   | Internal helper agent. Receives tasks from orchestrators. Gets restricted tool profile.      |

---

### `spec.runtime`

```yaml
spec:
  runtime:
    framework: openclaw # Always "openclaw" for now
    model:
      primary: anthropic/claude-sonnet-4-5-20250929
      fallback: anthropic/claude-haiku-4-5 # Optional
    compaction:
      mode: safeguard # Optional: "safeguard" | "aggressive" | "off"
```

| Field             | Type   | Required | Description                                                                                                                   |
| ----------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `framework`       | string | ✅       | Runtime framework. Only `openclaw` is supported.                                                                              |
| `model.primary`   | string | ✅       | Primary model. Format: `provider/model-id`.                                                                                   |
| `model.fallback`  | string | ❌       | Fallback model if primary fails or is rate-limited.                                                                           |
| `compaction.mode` | string | ❌       | Context window management. `safeguard` (default): compact when near limit. `aggressive`: compact early. `off`: never compact. |

---

### `spec.identity`

```yaml
spec:
  identity:
    soulPath: ./SOUL.md # Relative path to personality file
    onboarding: false # Whether to show first-run onboarding message
```

---

### `spec.persistence`

```yaml
spec:
  persistence:
    provider: azure-blob # "azure-blob" or "local"
    quota: 512MB
    layout:
      workspace: /workspace
      memory: /memory
      cache: /cache
```

| Field              | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `provider`         | `azure-blob` for production, `local` for dev.                         |
| `quota`            | Storage limit for this agent's workspace.                             |
| `layout.workspace` | Path prefix for workspace files within the agent's storage container. |

---

### `spec.skills`

```yaml
spec:
  skills:
    cortex:
      mcps: ["m365", "github"] # MCPs to enable
      tools:
        allow: # Explicit tool allowlist
          - "cortex_m365__list_events"
          - "cortex_m365__create_event"
        deny: # Tools to explicitly block (optional)
          - "cortex_exec__bash"
```

| Field                | Description                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cortex.mcps`        | List of MCP names to load for this agent. Available: `m365`, `github`, `notion`, `jira`, `slack`, `browser`, `linear`, `figma`. |
| `cortex.tools.allow` | Exact tool names the agent is permitted to use. If omitted, agent gets the full tool profile.                                   |
| `cortex.tools.deny`  | Tools to explicitly block even if they're in the profile.                                                                       |

Tool names follow the pattern `cortex_<mcp>__<action>` (e.g. `cortex_m365__create_event`).

---

### `spec.gateways`

```yaml
spec:
  gateways:
    msteams:
      enabled: true
    slack:
      enabled: false
```

Which messaging platforms this agent is reachable on. Currently `msteams` is the only production gateway.

---

### `spec.routing`

```yaml
spec:
  routing:
    intentKeywords:
      - "schedule a meeting"
      - "find a time"
    priority: 10 # Higher = checked first (default 0)
```

When a user message is received, the gateway checks all agents' `intentKeywords`. The agent with the highest `priority` whose keywords match claims the message.

---

### `spec.cron`

```yaml
spec:
  cron:
    - name: daily-briefing
      schedule: "0 7 * * 1-5" # Cron expression (UTC)
      action: compile-daily-briefing
      targets: subscribed-users # Informational label
```

| Field      | Required | Description                                       |
| ---------- | -------- | ------------------------------------------------- |
| `name`     | ✅       | Unique name for this job within the agent.        |
| `schedule` | ✅       | Standard 5-field cron expression (UTC timezone).  |
| `action`   | ✅       | String passed to the agent as the trigger prompt. |
| `targets`  | ❌       | Informational label for who the output goes to.   |

---

### `spec.collaboration`

```yaml
spec:
  collaboration:
    canContact: ["athena", "analyst"] # Agents this agent can query/delegate to
    acceptFrom: ["athena"] # Agents allowed to send messages to this one
    maxDelegationDepth: 2 # Max chain length for delegations
```

| Field                | Description                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `canContact`         | List of agent IDs this agent can reach via `ask_agent`, `delegate_to_agent`, or `notify_agent`. Use `["*"]` for unrestricted. |
| `acceptFrom`         | List of agent IDs whose messages this agent will accept. Messages from unlisted agents are rejected at the bus level.         |
| `maxDelegationDepth` | How many levels of delegation can chain. Prevents infinite loops. Default: 1.                                                 |

---

### `spec.access`

```yaml
spec:
  access:
    owners: ["joshual@sonance.com"] # Can edit agent config
    admins: ["elliott.amador@sonance.com"] # Can view all conversations
    users: ["*@sonance.com"] # Can chat with the agent
```

Glob patterns are supported in `users` (e.g. `"*@sonance.com"` allows all Sonance employees).

---

## Complete Example

```yaml
apiVersion: athena/v1
kind: Agent
metadata:
  name: analyst
  displayName: "Analyst"
  description: "Business intelligence, metrics, and data insights for Sonance leadership"
  avatar: "analyst.png"
  aliases: ["@analyst"]
  team: leadership
  owner: cto@sonance.com

spec:
  role: specialist

  runtime:
    framework: openclaw
    model:
      primary: anthropic/claude-sonnet-4-5-20250929
      fallback: anthropic/claude-haiku-4-5
    compaction:
      mode: safeguard

  identity:
    soulPath: ./SOUL.md
    onboarding: false

  skills:
    cortex:
      mcps: ["notion", "browser"]
      tools:
        allow:
          - "cortex_notion__search_pages"
          - "cortex_notion__get_page"
          - "cortex_browser__search"
          - "cortex_browser__fetch_page"

  routing:
    intentKeywords:
      - "analyze"
      - "metrics"
      - "performance data"
      - "OKR progress"
    priority: 5

  collaboration:
    canContact: ["athena"]
    acceptFrom: ["athena"]
    maxDelegationDepth: 1

  access:
    owners: ["cto@sonance.com"]
    admins: ["cto@sonance.com", "elliott.amador@sonance.com"]
    users: ["*@sonance.com"]
```
