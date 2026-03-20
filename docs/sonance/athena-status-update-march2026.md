# Athena Platform — Engineering Status Update

**Date:** March 10, 2026
**Author:** Josh
**Audience:** Engineering & Security Team
**Status:** Beta — internal employees onboarding

---

## What Is Athena?

Athena is Sonance's internal AI platform. It is a fleet of AI agents — each with a distinct identity, persistent memory, and curated access to company tools — deployed into the communications channels employees already use (Microsoft Teams).

Unlike a single shared chatbot, Athena is an **extensible multi-agent system**. Each agent is independently configured, has its own behavioral instructions (SOUL.md), and operates within a defined tool policy. Employees interact with the right agent for the right task, either by direct command or through automatic routing.

The platform is built on top of **OpenClaw** (open-source LLM agent runtime) with a Sonance-specific deployment layer that handles Teams integration, tool access via Cortex, multi-agent routing, and an administrative web portal.

---

## Current Agents in Production

| Agent         | Role         | Primary Use Case                                           | Tools                                                                        |
| ------------- | ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Athena**    | Orchestrator | General-purpose assistant, email, knowledge work           | Full M365 suite (email, calendar, tasks, contacts, files) + all Cortex tools |
| **Scheduler** | Specialist   | Calendar coordination, meeting scheduling, daily briefings | M365 calendar subset (17 tools) — no email, no file access                   |

Both agents respond in Microsoft Teams via the Athena bot. Users can address a specific agent with `/scheduler` or `@scheduler`, or write naturally and intent-based routing will select the appropriate agent automatically.

---

## Architecture

### High-Level Stack

```
Employees (Microsoft Teams)
        │
        ▼
Azure Bot Service  ──►  ngrok tunnel (dev) / Azure HTTPS endpoint (prod)
        │
        ▼
┌─────────────────────────────────────┐
│         OpenClaw Gateway            │  ← WebSocket gateway (port 18789)
│   - Message routing                 │  ← Teams bot listener (port 3978)
│   - Session management              │
│   - Agent supervisor (all agents)   │
│   - Plugin host                     │
└─────────┬───────────────────────────┘
          │
    ┌─────┴──────┐
    │            │
    ▼            ▼
Athena       Scheduler
(agent)      (agent)
    │            │
    └─────┬──────┘
          │
          ▼
  sonance-cortex plugin
  - Registers tools from Cortex MCPs
  - Manages M365 OAuth tokens per user
  - Audit sink (logs all tool calls)
  - Apollo proxy (LLM key management)
          │
          ▼
   Cortex Backend (Sonance-managed)
   - MCP servers: M365, GitHub, Asana, Salesforce, Slack, ...
   - OAuth flows and token storage
   - Tool execution
```

### Agent Definition Format

Each agent is defined as a versioned YAML file in `agents/definitions/<name>/agent.yaml`:

```yaml
apiVersion: athena/v1
kind: Agent
metadata:
  name: scheduler
  displayName: "Scheduler"
  owner: josh@sonance.com
spec:
  role: specialist # or: orchestrator
  runtime:
    model:
      primary: anthropic/claude-sonnet-4-5
      fallback: anthropic/claude-sonnet-4-5
  skills:
    cortex:
      mcps: ["m365"] # which Cortex MCPs this agent can access
      tools:
        allow: [list_events, create_event, get_schedule, ...]
  routing:
    intentKeywords: [schedule a meeting, find a time, ...]
    priority: 10
  collaboration:
    canContact: ["athena"] # inter-agent ACL
    acceptFrom: ["athena"]
  access:
    users: ["*@sonance.com"] # who can talk to this agent
```

SOUL.md (personality and behavioral instructions) sits alongside the YAML and is versioned in Azure Blob Storage. The last 10 versions are retained for rollback.

### Routing Logic

When a message arrives in Teams, routing applies in this order:

1. **Explicit command** — `/scheduler ...` or `!scheduler ...` → routes to Scheduler agent
2. **Intent keywords** — "schedule a meeting", "find a time" → routes to Scheduler via keyword match
3. **Default** — everything else → routes to Athena (orchestrator)

The session key is reconstructed correctly so each agent maintains its own independent conversation history per user.

### Inter-Agent Communication

Agents can delegate tasks to each other via the `ask_agent` tool. Athena (orchestrator) can query Scheduler without the user having to explicitly address it. ACLs in `agent.yaml` (`collaboration.canContact`) control which agents can initiate contact with which. Currently:

- Athena can ask Scheduler
- Scheduler can ask Athena
- Max delegation depth: 1 (no recursive chains)

### Persistence

| Layer                | Technology            | What's Stored                                                                                              |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Conversation history | Supabase (Postgres)   | All messages, roles, tool calls, token counts                                                              |
| Agent memory         | Supabase (Postgres)   | Per-user preferences, facts, context (by agent)                                                            |
| Usage metrics        | Supabase (Postgres)   | Daily aggregates: conversations, messages, tool calls, tokens, errors                                      |
| Audit events         | Supabase (Postgres)   | Every tool call with agent ID, user ID, tool name, parameters (sensitive values redacted), success/failure |
| Cron jobs            | Supabase (Postgres)   | Scheduled tasks and run history                                                                            |
| Agent workspaces     | Azure Blob Storage    | SOUL.md versions, file artifacts, per-user memory files                                                    |
| LLM keys             | Cortex / Apollo proxy | Centralized — not stored in Athena                                                                         |
| M365 OAuth tokens    | Cortex M365 MCP       | Managed by Cortex — Athena never holds raw OAuth tokens                                                    |

In development, SQLite mirrors the Postgres schema locally so the full platform runs offline.

### Admin Portal

A web-based control portal is served from the gateway and accessible at the gateway URL. Currently implemented:

| Page               | Path               | What it shows                                                                                     |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------- |
| Dashboard          | `/dashboard`       | Personal activity stats, platform agent counts, MCP connection status                             |
| Command Center     | `/command-center`  | Agent org-chart (hierarchy + Sonance departments)                                                 |
| Agents             | `/platform/agents` | Agent table (model, role, status, conversations, messages, errors), SOUL.md editor, create/delete |
| Cortex Connections | `/cortex`          | All available MCP integrations and their OAuth status                                             |
| Usage              | `/usage`           | 7-day agent-level usage table                                                                     |
| Chat               | `/chat`            | Embedded chat interface                                                                           |

Still to be built: conversation browser (searchable history), skills inventory (which tools per agent), cron monitor.

---

## How Employees Access Athena

**Current method:** Microsoft Teams, via the Athena bot registered in the Sonance Azure AD tenant.

1. Employee opens a Direct Message with the "Athena" bot in Teams
2. Sends a message — Athena responds, maintaining conversation memory per user
3. To use the Scheduler agent: prefix message with `/scheduler` or write naturally ("schedule a meeting with...") — intent routing handles the rest
4. On first use, Athena will prompt the employee to authorize their M365 account via OAuth (once only, tokens managed by Cortex)

**Authentication flow:**

- Bot validates incoming messages against Azure Bot Service (JWT token verification)
- Each user's Teams AAD Object ID is their unique identifier across the platform
- No additional login required — Teams identity is the auth mechanism
- M365 OAuth is per-user and isolated — one user cannot access another's calendar, email, or files

---

## Security

### What's Implemented

| Control                         | Status  | Detail                                                                                                         |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| Per-user M365 token isolation   | ✅ Done | Fixed in `c01701f99` — session-scoped tokens, no cross-user leakage possible                                   |
| Bot message authentication      | ✅ Done | Azure Bot Framework JWT validation on every inbound message                                                    |
| Tool audit log                  | ✅ Done | Every tool call logged to `audit_events` table with user ID, agent, params (sensitive values redacted)         |
| Per-agent tool policy           | ✅ Done | Specialist agents get a restricted tool profile (~13 tools); cannot call tools outside their defined allowlist |
| Agent ACL for inter-agent calls | ✅ Done | `collaboration.canContact` / `acceptFrom` in agent.yaml — agents can only contact permitted peers              |
| Agent access scoping            | ✅ Done | `access.users: ["*@sonance.com"]` limits agent access to Sonance domain accounts                               |
| SOUL.md version history         | ✅ Done | Last 10 versions in Azure Blob Storage — rollback available                                                    |
| No raw token storage in Athena  | ✅ Done | All OAuth tokens held by Cortex; Athena receives tool results only                                             |

### What Is Still Needed

| Control                            | Status     | Priority                                                                                                   |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| Azure production deployment        | ⚠️ Pending | High — currently local + ngrok; bot dies if Mac sleeps                                                     |
| Conversation data retention policy | ⚠️ Pending | High — default 90 days; needs legal/policy sign-off                                                        |
| Anthropic DPA / BAA confirmation   | ⚠️ Pending | High — conversations sent to Anthropic for inference                                                       |
| M365 OAuth scope review            | ⚠️ Pending | Medium — scopes should be least-privilege; needs security review                                           |
| Admin portal access control        | ⚠️ Pending | Medium — portal currently requires gateway token; role-based access (admin vs. read-only) not yet enforced |
| PII classification of agent memory | ⚠️ Pending | Medium — agent memory stores user preferences, colleague names; confirm PII policy                         |
| Audit log viewer in portal         | ⚠️ Pending | Medium — data is captured, UI not built yet                                                                |
| Incident response process          | ⚠️ Pending | Low — no documented process for agent misbehavior (prompt injection, data leak)                            |
| Geo-redundant blob storage (GRS)   | ⚠️ Pending | Low — RPO/RTO for agent workspaces and memory not defined                                                  |

### Key Security Architecture Decisions

**Q: Can Agent A read Agent B's user data?**
No. Each agent's workspace, memory, and conversation history is namespaced by `(agent_id, user_id)`. The database schema enforces this. An agent has no mechanism to query another agent's stored data.

**Q: Can an employee access another employee's conversations?**
No. The gateway requires authentication (gateway token). The admin portal allows admins to view platform-level metrics (aggregate, not individual conversations). Individual conversation content is scoped per `user_id`.

**Q: Who can add or modify agents?**
Currently: anyone with access to the repo and gateway config. Post Phase 5, the admin portal will manage this. Recommend: gate agent definitions behind a PR review process now.

**Q: What happens if a prompt injection attack occurs?**
Currently: the agent follows its SOUL.md behavioral restrictions, and tool calls are audited. There is no active prompt injection detection. This is a Phase 6 concern. For now, tool policy restrictions (specialists have limited tool access) contain the blast radius.

**Q: Is data sent to Anthropic?**
Yes — conversation messages are sent to Anthropic Claude for inference. Anthropic's enterprise terms state they do not train on customer data. A formal DPA should be confirmed before expanding to all employees.

---

## Infrastructure

### Current (Development)

```
MacBook Pro (local)
├── OpenClaw gateway (ports 18789 + 3978)
├── Cortex sidecar (local)
├── ngrok tunnel (routes Teams webhooks to port 3978)
└── SQLite (local DB during dev)
```

The bot is **not yet deployed to the cloud**. It depends on the MacBook being on and ngrok running. This is not suitable for production.

### Target (Production — Azure)

```
Azure Container App: gateway
├── 2 vCPU, 4 GB RAM, minReplicas: 2 (HA baseline)
├── Rolling deploys (zero downtime)
├── Env vars via Azure Key Vault reference
└── HTTPS endpoint registered in Azure Bot Service

Azure Container App: cortex sidecar
└── 1 vCPU, 2 GB RAM

Supabase (Postgres): conversations, memory, metrics, audit, cron
Azure Blob Storage: agent workspaces, SOUL.md versions, memory files
Azure Container Registry: gateway + cortex images
```

Estimated infrastructure cost: **~$260/month** (fixed) + **~$200-400/month** LLM costs at current usage. At 200 employees with active daily use: ~$1,500-2,500/month total.

---

## What Works Today (March 10, 2026)

- ✅ Athena agent responding in Teams — general-purpose, M365-connected
- ✅ Scheduler agent — calendar, meeting scheduling, M365 calendar tools
- ✅ Slash command routing (`/scheduler`) and intent-based routing
- ✅ Inter-agent delegation (Athena → Scheduler, Scheduler → Athena)
- ✅ Per-user M365 OAuth — each employee authorizes their own account once
- ✅ Conversation history and agent memory persisted in Supabase
- ✅ Full tool audit trail in `audit_events` table
- ✅ SOUL.md versioned with rollback capability
- ✅ Admin portal: dashboard, agents, org chart, Cortex connections, usage stats
- ✅ SOUL.md editor in admin portal — edit and save agent personality live

## What's In Progress / Next

| Item                                         | Phase   | Priority                                              |
| -------------------------------------------- | ------- | ----------------------------------------------------- | --- |
| Azure production deployment                  | Infra   | 🔴 Immediate — bot should not depend on local machine |
| Conversation browser (searchable)            | Phase 3 | 🟠 High                                               |
| Skills inventory (which tools, which agents) | Phase 4 | 🟡 Medium                                             |
| Cron job monitor                             | Phase 4 | 🟡 Medium                                             |
| Audit log viewer in portal                   | Phase 4 | 🟡 Medium                                             |
| Deployment map + health metrics per agent    | Phase 5 | 🟡 Medium                                             |
| SOUL.md rollback UI                          | Phase 5 | 🟡 Medium                                             | Z   |
| Agent `delegate` and `notify` patterns       | Phase 6 | 🟢 Future                                             |
| Multi-agent Teams "Roundtable" mode          | Phase 6 | 🟢 Future                                             |
| Formal security review                       | —       | 🔴 Before expanding to all employees                  |

---

## Questions for the Team

1. **Deployment timeline** — When do we move to Azure production? The bot currently requires the local machine to be running.
2. **Anthropic DPA** — Has a Data Processing Agreement been confirmed for employee conversation data? Required before broad rollout.
3. **Data retention** — Should conversation history be retained for 90 days (proposed default)? What is the deletion policy?
4. **M365 OAuth scope review** — Security should review the specific OAuth scopes used by the Cortex M365 integration against least-privilege requirements.
5. **Agent governance** — Should new agent definitions require a formal review/approval process before being added to the platform?
6. **Admin portal access** — Who should have admin access to the portal? Should we implement role-based access (admin vs. read-only viewer)?

---

_Internal document — not for external distribution._
_Questions: Josh | Repo: Athena/Athena (branch: josh-staging)_
