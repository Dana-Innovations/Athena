# Athena Platform: Architecture & Deployment Proposal

**Version:** 1.1 — Updated with database layer, agent communication protocol, HA baseline  
**Date:** February 20, 2026  
**Author:** Josh (Engineering), with AI-assisted planning  
**Reviewers:** Elliott (Infrastructure)  
**Audience:** Security Team, Infrastructure Development Team  
**Status:** Proposal — requesting feedback before implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State](#2-current-state)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Agent Schema & Lifecycle](#4-agent-schema--lifecycle)
5. [Deployment & Hosting](#5-deployment--hosting)
6. [Networking & Gateway Architecture](#6-networking--gateway-architecture)
7. [Persistence & Storage](#7-persistence--storage)
8. [Database Layer](#8-database-layer)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [Cortex Integration (Skills & Tools)](#10-cortex-integration-skills--tools)
11. [Agent Communication Protocol](#11-agent-communication-protocol)
12. [Admin Portal](#12-admin-portal)
13. [Security Considerations](#13-security-considerations)
14. [Cost Analysis](#14-cost-analysis)
15. [Risks & Open Questions](#15-risks--open-questions)
16. [Implementation Phases](#16-implementation-phases)

---

## 1. Executive Summary

Athena is an internal platform for building, managing, and deploying AI agents across Sonance. Agents are conversational AI assistants with persistent memory, distinct identities, and access to company tools (Microsoft 365, Asana, GitHub, Salesforce, etc.) through a backend called Cortex.

**Current state:** Athena is a single AI assistant deployed as a Microsoft Teams bot. It runs on Azure Container Apps and connects to Cortex for tool execution. A small group of employees are testing it in a controlled rollout.

**Proposed shift:** Evolve Athena from a single bot into a multi-agent platform where Sonance can define, deploy, and manage multiple specialized agents — each with their own identity, skills, and memory — accessible through Teams, a web portal, and APIs.

**Why this matters:**

- Agents become reusable infrastructure, not one-off bots
- New agents can be created in minutes (one config file), not weeks
- The platform is framework-agnostic — if a better AI runtime emerges, agents port over without losing their data
- Centralized governance: one place to audit what agents can do, who they serve, and what data they access

---

## 2. Current State

### 2.1 Architecture (Today)

```
┌──────────────────────────────────────────────────────────────┐
│                   Azure Container Apps                        │
│                                                               │
│  ┌─────────────────────────┐   ┌──────────────────────────┐  │
│  │  athena-gateway          │   │  cortex (sidecar)         │  │
│  │  (Node.js / OpenClaw)    │   │  (Python / FastAPI)       │  │
│  │                          │   │                           │  │
│  │  Single agent: "Athena"  │──→│  M365 MCP (Graph API)     │  │
│  │  Teams bot on port 3978  │   │  OAuth token management   │  │
│  │  Gateway on port 18789   │   │  Tool execution engine    │  │
│  └────────────┬─────────────┘   └──────────────────────────┘  │
│               │                                               │
└───────────────┼───────────────────────────────────────────────┘
                │
    ┌───────────▼───────────┐
    │  Azure Bot Service     │
    │  (Teams channel)       │
    │  Messaging endpoint    │
    └───────────┬───────────┘
                │
    ┌───────────▼───────────┐
    │  Microsoft Teams       │
    │  DM with "Athena"      │
    │  Controlled user list  │
    └───────────────────────┘
```

### 2.2 Technology Stack

| Component          | Technology                                 | Purpose                                            |
| ------------------ | ------------------------------------------ | -------------------------------------------------- |
| Agent Runtime      | OpenClaw (Node.js, TypeScript)             | LLM orchestration, tool calling, memory, streaming |
| Tool Backend       | Cortex (Python, FastAPI)                   | Tool execution, OAuth management, MCP protocol     |
| LLM Provider       | Anthropic Claude (via Apollo proxy)        | Language model for agent reasoning                 |
| Messaging          | Microsoft Teams (Bot Framework)            | User-facing chat interface                         |
| Hosting            | Azure Container Apps                       | Container orchestration, scaling, TLS              |
| Container Registry | Azure Container Registry (`sonanceathena`) | Docker image storage                               |
| Auth (SSO)         | AI Intranet (Okta-backed)                  | Employee authentication                            |
| Auth (M365)        | Azure AD OAuth 2.0                         | Per-user Microsoft 365 delegated access            |

### 2.3 What Works Today

- Single agent ("Athena") accessible via Teams DM to a controlled allowlist of 4 users
- Microsoft 365 integration: calendar (including cross-user free/busy via `getSchedule`), email, contacts, files, Teams chat, tasks, OneNote
- Per-user OAuth: each user authenticates with their own M365 account; Athena acts on their behalf
- Per-user memory: Athena remembers user preferences and context across conversations
- Apollo proxy: all LLM requests route through Cortex for rate limiting, billing, and usage tracking
- SSO authentication via Sonance AI Intranet (Okta) for the web control UI

### 2.4 Codebase

- **Athena repo** (`github.com/Dana-Innovations/Athena`): Fork of OpenClaw, with Sonance-specific extensions
- **Cortex repo** (`github.com/Dana-Innovations/Cortex`): Tool execution backend, MCP protocol bridge
- The fork tracks upstream OpenClaw for runtime improvements while maintaining Sonance customizations in separate directories (`extensions/sonance-cortex/`, `deploy/`, `agents/`, `platform/`)

---

## 3. Proposed Architecture

### 3.1 High-Level View

```
┌─────────────────────────────────────────────────────────────────┐
│                        ADMIN PORTAL (Web UI)                     │
│  Org Chart │ Command Center │ Deployment Map │ Agent Manager     │
├─────────────────────────────────────────────────────────────────┤
│                          ADMIN API                               │
│  Agent CRUD │ Health Checks │ Metrics │ Cron Status              │
├─────────────────────────────────────────────────────────────────┤
│                        GATEWAY LAYER                             │
│  Teams (Bot Framework) │ Web UI Chat │ REST API │ Future: Slack  │
│                    Message Router                                │
│              (alias / bot ID / URL path → agent)                 │
├─────────────────────────────────────────────────────────────────┤
│                       AGENT RUNTIME                              │
│  Supervisor Process                                              │
│  ├── Agent: athena      (personal assistant)                     │
│  ├── Agent: scheduler   (meeting coordination)                   │
│  ├── Agent: analyst     (data & reporting)                       │
│  └── Agent: ops         (devops & monitoring)                    │
│  Each agent: own workspace, SOUL.md, memory, tool profile        │
│                  Agent Message Bus (inter-agent comms)            │
├─────────────────────────────────────────────────────────────────┤
│                     PERSISTENCE LAYER                            │
│  Supabase (Postgres)           │  Azure Blob Storage             │
│  ├── conversations & messages  │  ├── agent workspaces (files)   │
│  ├── structured user memory    │  ├── SOUL.md versions           │
│  ├── usage metrics & analytics │  ├── tool result cache          │
│  └── cron job state            │  └── large file artifacts       │
├─────────────────────────────────────────────────────────────────┤
│                   SKILLS & TOOLS (CORTEX)                        │
│  M365 │ Asana │ GitHub │ Slack │ Salesforce │ Power BI │ Custom  │
│  OAuth management │ Per-agent tool profiles │ Usage tracking     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Key Design Principles

1. **Agents are defined declaratively** — YAML config + SOUL.md, not code
2. **Gateway-agnostic** — agents don't know or care whether the user is on Teams, web, or API
3. **Framework-portable** — the agent schema is the contract; the runtime (OpenClaw) is a swappable adapter
4. **Shared infrastructure** — all agents share one gateway process and one Cortex instance (cost-efficient)
5. **Centralized governance** — one admin portal to manage all agents, tools, and access
6. **Hybrid persistence** — database for structured/queryable data, blob storage for files and artifacts
7. **Agents can collaborate** — a defined inter-agent message protocol enables multi-agent workflows

---

## 4. Agent Schema & Lifecycle

### 4.1 Agent Definition Format

Each agent is defined by a YAML configuration file and supporting documents:

```yaml
# agents/definitions/athena/agent.yaml
apiVersion: athena/v1
kind: Agent
metadata:
  name: athena
  displayName: "Athena"
  description: "Personal AI assistant for Sonance employees"
  avatar: "athena.png"
  aliases: ["@athena"]
  team: company-wide
  owner: josh@sonance.com

spec:
  runtime:
    framework: openclaw
    model:
      primary: anthropic/claude-sonnet-4-5-20250929
      fallback: anthropic/claude-haiku-4-5-20251001
    compaction:
      mode: safeguard

  identity:
    soulPath: ./SOUL.md
    onboarding: true

  persistence:
    provider: azure-blob
    quota: 1GB
    layout:
      workspace: /workspace
      memory: /memory
      cache: /cache

  skills:
    cortex:
      mcps: ["m365"]
      tools:
        allow: ["cortex_m365__*"]

  gateways:
    teams:
      enabled: true
      appId: "78bdfd6c-d857-4c2b-b9ea-7ce57befe693"
      dmPolicy: allowlist
      groupPolicy: mention
    web:
      enabled: true
    api:
      enabled: true
      rateLimit: 100/min

  cron:
    - name: daily-briefing
      schedule: "0 8 * * 1-5"
      action: send-daily-briefing
      targets: subscribed-users

  access:
    owners: ["josh@sonance.com"]
    users: ["*@sonance.com"]
```

### 4.2 Agent Directory Structure

```
agents/definitions/athena/
├── agent.yaml          # Configuration (parsed and validated at startup)
├── SOUL.md             # Personality, instructions, behavioral guidelines
├── skills.yaml         # Detailed skill/tool configuration (optional)
└── onboarding.md       # First-time user onboarding script (optional)
```

### 4.3 Agent Lifecycle

```
Define (YAML) → Validate (schema check) → Register (agent registry)
    → Deploy (container restart picks up new agent)
    → Route (gateway maps messages to agent)
    → Run (OpenClaw runtime handles conversations)
    → Monitor (admin portal shows health, usage, errors)
    → Update (edit YAML/SOUL.md, redeploy)
    → Retire (disable in config, data preserved in blob storage)
```

### 4.4 Portability Guarantee

The agent schema (`athena/v1`) is the stable contract. The runtime is an adapter:

```
agent.yaml (stable)  →  OpenClaw Adapter (today)
                     →  CrewAI Adapter (hypothetical future)
                     →  LangGraph Adapter (hypothetical future)
```

To switch frameworks: write a new adapter that reads the same `agent.yaml` and `SOUL.md`, maps them to the new runtime's configuration, and connects to the same persistence layer. Memory, workspace files, and user data persist in blob storage regardless of runtime.

---

## 5. Deployment & Hosting

### 5.1 Container Architecture

All agents run in a **single gateway container**. OpenClaw natively supports multiple agents within one process through its agent registry.

```
┌───────────────────────────────────────────────────────────┐
│              Azure Container Apps Environment              │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  athena-gateway (container, 2 vCPU / 4 GB RAM)   │     │
│  │                                                   │     │
│  │  OpenClaw Gateway Process                         │     │
│  │  ├── Agent: athena    (workspace, SOUL, memory)   │     │
│  │  ├── Agent: scheduler (workspace, SOUL, memory)   │     │
│  │  ├── Agent: analyst   (workspace, SOUL, memory)   │     │
│  │  └── Agent: ops       (workspace, SOUL, memory)   │     │
│  │                                                   │     │
│  │  Ports: 18789 (gateway), 3978 (Teams bot)         │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  cortex (sidecar container, 1 vCPU / 2 GB RAM)   │     │
│  │                                                   │     │
│  │  FastAPI (Python)                                 │     │
│  │  ├── M365 MCP                                     │     │
│  │  ├── GitHub MCP                                   │     │
│  │  ├── Asana MCP                                    │     │
│  │  ├── Salesforce MCP                               │     │
│  │  └── ... (per-agent tool profiles)                │     │
│  │                                                   │     │
│  │  Port: 8000                                       │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  Azure Blob Storage (mounted volume)              │     │
│  │  /agents/athena/{workspace,memory,cache}/         │     │
│  │  /agents/scheduler/{workspace,memory,cache}/      │     │
│  │  /agents/analyst/{workspace,memory,cache}/        │     │
│  └──────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────┘
```

### 5.2 Why Shared Process (Not One Container Per Agent)

| Factor                    | Shared Process                           | Per-Agent Containers            |
| ------------------------- | ---------------------------------------- | ------------------------------- |
| Cost (5 agents)           | ~$260/month (2 replicas)                 | ~$600+/month                    |
| Startup time              | Instant (agents loaded at boot)          | 10-30s cold start per container |
| Inter-agent communication | In-process message bus (fast)            | Network calls (slow, complex)   |
| Deployment complexity     | One container to manage                  | N containers, N deployments     |
| Isolation                 | Process-level (shared memory space)      | Full container isolation        |
| Scaling                   | Scale the whole gateway                  | Scale individual agents         |
| State management          | Database (Supabase) — stateless replicas | Same, or per-container state    |

**Decision:** Start with shared process. Move to per-agent containers only if isolation or scaling requirements demand it (unlikely for <20 agents).

### 5.3 Scaling Configuration

```yaml
# Azure Container App scaling
scaling:
  minReplicas: 2 # Zero-downtime deploys + crash resilience
  maxReplicas: 4 # Scale out under load
  rules:
    - name: concurrent-requests
      type: http
      metadata:
        concurrentRequests: 50 # Scale at 50 concurrent requests
```

- **minReplicas: 2** from day one — this eliminates single-point-of-failure during rolling updates and crash recovery. The extra ~$90/month (one additional replica) buys zero-downtime deploys for a platform people depend on daily.
- Azure Container Apps handles health checks, auto-restart on crash, and rolling updates across replicas
- Horizontal scaling adds replicas behind a load balancer; all replicas read from the same blob storage and database
- Stateless gateway design: any replica can handle any request (conversation state is in the database, not in-process)

### 5.4 Heavy Workloads (Container Jobs)

For compute-intensive tasks (large data analysis, batch processing, long-running cron jobs), agents offload work to Azure Container Apps Jobs:

```
User: "Analyze all Q4 sales data and generate a report"
    │
    ▼
Agent (in gateway): Acknowledges request, queues a Container Job
    │
    ▼
Container Job: Spins up (4 vCPU, 8 GB), runs analysis, writes to blob storage
    │
    ▼
Agent: Notifies user when complete, provides results from blob storage
```

Container Jobs are billed per-second and shut down when complete. A 10-minute job on 4 vCPU costs approximately $0.01.

### 5.5 Adding a New Agent

1. Create `agents/definitions/<name>/agent.yaml` and `SOUL.md`
2. (Optional) Register a new Azure Bot for Teams identity
3. Run `pnpm athena deploy` (rebuilds container image, updates Container App)
4. Gateway picks up new agent on startup, creates workspace in blob storage
5. Agent is live — no new infrastructure provisioned

### 5.6 Updating an Existing Agent

- **SOUL.md or skill changes:** Edit the file, redeploy. Agent picks up changes on next restart.
- **Model upgrade:** Change `spec.runtime.model.primary` in YAML, redeploy.
- **Framework swap:** Change `spec.runtime.framework`, implement new adapter, redeploy. Workspace data persists.

---

## 6. Networking & Gateway Architecture

### 6.1 Inbound Traffic Flow

```
                    Internet
                       │
          ┌────────────┼────────────┐
          │            │            │
    Teams Bot    Web Portal    REST API
    Service      (HTTPS)       (HTTPS)
          │            │            │
          ▼            ▼            ▼
    ┌─────────────────────────────────┐
    │  Azure Container App (Ingress)   │
    │  TLS termination, FQDN          │
    │  athena-gateway.*.azurecontainer │
    │  apps.io                         │
    └──────────────┬──────────────────┘
                   │
    ┌──────────────▼──────────────────┐
    │        Gateway Router            │
    │                                  │
    │  Teams msg (bot ID: abc) → athena│
    │  Teams msg (bot ID: def) → sched │
    │  Web chat (agent=analyst) → anlst│
    │  API POST /agents/ops/msg → ops  │
    └──────────────┬──────────────────┘
                   │
              Agent Runtime
```

### 6.2 Port Allocation

| Port  | Protocol         | Purpose                             | Exposure                |
| ----- | ---------------- | ----------------------------------- | ----------------------- |
| 18789 | WebSocket + HTTP | Gateway (control UI, API, web chat) | Internal + Ingress      |
| 3978  | HTTP             | Teams Bot Framework adapter         | Internal + Ingress      |
| 8000  | HTTP             | Cortex API (tool execution)         | Internal only (sidecar) |

### 6.3 Teams Multi-Bot Routing

**Phase 1 (Single Bot — Recommended Start):** One Azure Bot registration, all agents behind a single Teams contact. Users specify the agent via slash commands (`/scheduler find a time`, `/analyst pull Q4 data`) or the gateway infers from context. This avoids Azure AD governance friction (each bot registration = an app registration that may require admin approval) and allows faster adoption with zero additional Azure AD setup.

**Phase 2 (Multi-Bot):** Each agent gets its own Azure Bot registration with a unique App ID and App Password. Users see separate contacts in Teams. The gateway router maps the incoming Bot Framework `appId` to the corresponding agent. **Before implementing Phase 2:** confirm with the Azure AD admin whether there is an org-level approval workflow, naming convention, or limit on Bot registrations in Sonance's tenant.

### 6.4 DNS & TLS

- Azure Container Apps provides a managed FQDN with auto-renewed TLS certificates
- Custom domain (e.g., `athena.sonance.com`) can be mapped via CNAME
- All traffic is HTTPS/WSS; no plaintext connections accepted

---

## 7. Persistence & Storage

The platform uses a **hybrid persistence model**: a database for structured, queryable data (conversations, memory, metrics) and blob storage for files and artifacts (workspaces, large outputs, cached results).

### 7.1 Hybrid Storage Architecture

```
┌─────────────────────────────┐  ┌────────────────────────────────┐
│  Supabase (Postgres)         │  │  Azure Blob Storage             │
│                              │  │                                 │
│  Structured & queryable:     │  │  Files & artifacts:             │
│  ├── agent_conversations     │  │  ├── /agents/{id}/workspace/    │
│  ├── agent_messages          │  │  ├── /agents/{id}/cache/        │
│  ├── agent_memory            │  │  ├── /agents/{id}/soul/         │
│  ├── agent_memory_entries    │  │  │   ├── SOUL.md (current)      │
│  ├── usage_metrics           │  │  │   ├── SOUL.v3.md             │
│  ├── cron_jobs               │  │  │   ├── SOUL.v2.md             │
│  ├── cron_runs               │  │  │   └── SOUL.v1.md             │
│  └── audit_events            │  │  └── /agents/{id}/artifacts/    │
└─────────────────────────────┘  └────────────────────────────────┘
```

**Why hybrid (not blob-only):** At 200 users × 5 agents = 1,000 memory files, searching across them (e.g., "what does any agent know about Project X?") requires reading every file. A database enables instant queries, cross-agent analytics, and the searchable conversation history the Command Center needs.

### 7.2 Blob Storage Layout

```
sonance-athena-storage (Storage Account)
└── agents/
    ├── athena/
    │   ├── workspace/              # Working files, scratch space, outputs
    │   ├── cache/                  # Tool result cache (auto-expire 24h)
    │   ├── soul/                   # Versioned SOUL.md history
    │   │   ├── SOUL.md             # Current active version
    │   │   ├── SOUL.v3.md          # Previous version (for rollback)
    │   │   ├── SOUL.v2.md
    │   │   └── SOUL.v1.md
    │   └── artifacts/              # Large outputs (reports, exports)
    ├── scheduler/
    │   ├── workspace/
    │   ├── soul/
    │   └── ...
    └── analyst/
        └── ...
```

SOUL.md versioning: Git is the source of truth for agent definitions. Blob storage keeps the last N versions (default: 10) for **hot rollback without redeploy** — the Admin Portal can revert an agent's personality instantly by swapping which version file is active.

### 7.3 Data Classification

| Data Type                    | Sensitivity                                  | Storage Location                       | Retention                                 |
| ---------------------------- | -------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| Agent config (YAML, SOUL.md) | Low                                          | Git repo + blob (versioned)            | Permanent (git); last 10 versions (blob)  |
| User memory (structured)     | **Medium-High** (preferences, work patterns) | Supabase (encrypted at rest)           | Until user requests deletion              |
| Conversation history         | **High** (business content)                  | Supabase (encrypted at rest)           | Configurable per agent (default: 90 days) |
| Workspace files              | Low-Medium                                   | Azure Blob Storage (encrypted at rest) | Agent-managed                             |
| Tool result cache            | Low-Medium                                   | Azure Blob Storage                     | Auto-expire (24 hours)                    |
| Usage metrics                | Low                                          | Supabase                               | 1 year rolling                            |
| Audit events                 | Medium                                       | Supabase                               | 1 year (or per compliance policy)         |
| OAuth tokens                 | **Critical**                                 | Cortex database (encrypted, separate)  | Refresh-based (auto-rotate)               |

### 7.4 Storage Abstraction

The persistence layer is provider-agnostic for file storage:

```typescript
interface FileStorageProvider {
  read(agentId: string, path: string): Promise<Buffer>;
  write(agentId: string, path: string, data: Buffer): Promise<void>;
  list(agentId: string, prefix: string): Promise<string[]>;
  delete(agentId: string, path: string): Promise<void>;
  getQuotaUsage(agentId: string): Promise<{ used: number; limit: number }>;
}
```

Implementations: `AzureBlobProvider` (production), `LocalFsProvider` (development).

The database layer uses Supabase client SDK (see Section 8), with a `LocalSqliteProvider` for development that mirrors the same schema.

---

## 8. Database Layer

### 8.1 Technology Choice: Supabase (Postgres)

Supabase provides managed Postgres with a REST API, real-time subscriptions, and row-level security. Sonance already uses Supabase for Cortex file sync (`bylqwhuiuqbljpnpkdlz.supabase.co`). The Athena database will be a **separate Supabase project** to maintain isolation.

**Why Supabase over alternatives:**

| Option              | Pros                                                                                             | Cons                                                | Decision                   |
| ------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------- |
| Supabase (Postgres) | Existing Sonance pattern, real-time subscriptions for admin portal, full SQL, row-level security | External dependency                                 | **Selected**               |
| Azure Cosmos DB     | Native to Azure, global distribution                                                             | Expensive at scale, proprietary query language      | Overkill for this use case |
| SQLite sidecar      | Zero external deps, embedded                                                                     | No concurrent access across replicas, no real-time  | Good for dev only          |
| Azure SQL           | Native to Azure, full SQL                                                                        | More expensive than Supabase, no built-in real-time | Not needed                 |

### 8.2 Database Schema

```sql
-- Conversations: one row per user↔agent conversation session
CREATE TABLE agent_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,                    -- "athena", "scheduler"
    user_id         TEXT NOT NULL,                    -- Cortex/SSO user ID
    user_email      TEXT,                             -- josh@sonance.com
    gateway         TEXT NOT NULL,                    -- "teams", "web", "api"
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    message_count   INT NOT NULL DEFAULT 0,
    token_usage     JSONB DEFAULT '{}',              -- {input: N, output: N}
    metadata        JSONB DEFAULT '{}',              -- gateway-specific data
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_agent ON agent_conversations(agent_id, last_message_at DESC);
CREATE INDEX idx_conversations_user ON agent_conversations(user_id, last_message_at DESC);

-- Messages: individual messages within conversations
CREATE TABLE agent_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    agent_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    role            TEXT NOT NULL,                    -- "user", "assistant", "tool"
    content         TEXT NOT NULL,
    tool_calls      JSONB,                           -- [{name, args, result}]
    token_count     INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON agent_messages(conversation_id, created_at);
CREATE INDEX idx_messages_search ON agent_messages USING gin(to_tsvector('english', content));

-- Structured user memory: queryable by topic, agent, date
CREATE TABLE agent_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    category        TEXT NOT NULL,                    -- "preference", "context", "fact"
    topic           TEXT NOT NULL,                    -- "meeting_style", "project_x", "team"
    content         TEXT NOT NULL,                    -- The actual memory content
    confidence      REAL DEFAULT 1.0,                -- How sure the agent is (0-1)
    source          TEXT,                             -- "user_stated", "inferred", "tool_result"
    last_accessed   TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,                     -- Optional TTL
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, user_id, topic)                 -- One memory per topic per user per agent
);

CREATE INDEX idx_memory_agent_user ON agent_memory(agent_id, user_id);
CREATE INDEX idx_memory_search ON agent_memory USING gin(to_tsvector('english', content));

-- Usage metrics: aggregated per agent per day
CREATE TABLE usage_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,
    date            DATE NOT NULL,
    conversations   INT NOT NULL DEFAULT 0,
    messages        INT NOT NULL DEFAULT 0,
    tool_calls      INT NOT NULL DEFAULT 0,
    tokens_input    BIGINT NOT NULL DEFAULT 0,
    tokens_output   BIGINT NOT NULL DEFAULT 0,
    errors          INT NOT NULL DEFAULT 0,
    avg_latency_ms  INT,
    unique_users    INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, date)
);

-- Cron job definitions and run history
CREATE TABLE cron_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,
    name            TEXT NOT NULL,
    schedule        TEXT NOT NULL,                    -- Cron expression
    action          TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, name)
);

CREATE TABLE cron_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running',  -- "running", "success", "failed"
    result          JSONB,
    error           TEXT
);

-- Audit trail
CREATE TABLE audit_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      TEXT NOT NULL,                    -- "tool_call", "agent_config_change", "admin_action"
    agent_id        TEXT,
    user_id         TEXT,
    action          TEXT NOT NULL,                    -- "cortex_m365__create_event", "soul_updated"
    details         JSONB,                            -- Parameters, result summary (sensitive values redacted)
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_agent ON audit_events(agent_id, created_at DESC);
CREATE INDEX idx_audit_type ON audit_events(event_type, created_at DESC);
```

### 8.3 What the Database Enables

| Admin Portal Feature                        | Database Query                                   |
| ------------------------------------------- | ------------------------------------------------ |
| "Show all conversations about Salesforce"   | Full-text search on `agent_messages.content`     |
| "Which agents does Josh use most?"          | Aggregate `agent_conversations` by `user_id`     |
| "What does any agent know about Project X?" | Search `agent_memory` across all agents by topic |
| "Daily active users per agent"              | Query `usage_metrics` time series                |
| "Failed cron jobs this week"                | Filter `cron_runs` by `status = 'failed'`        |
| "All tool calls by the ops agent today"     | Filter `audit_events` by agent + date            |
| "Rollback agent memory for a user"          | Soft-delete or version `agent_memory` rows       |

### 8.4 Row-Level Security

Supabase row-level security (RLS) ensures:

- Agents can only read/write their own conversations and memory rows (`agent_id` filter)
- The Admin API can read across all agents (service role key)
- The Supabase anon key (used by the Admin Portal frontend) can only read data the authenticated SSO user is authorized to see

### 8.5 Local Development

For local dev, a `LocalSqliteProvider` mirrors the Postgres schema using SQLite. The `dev-local.sh` script creates a SQLite file at `.local-dev/athena.db`. Production uses the Supabase Postgres instance.

---

## 9. Authentication & Authorization

### 9.1 Authentication Layers

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: User → Platform (SSO)                           │
│ Sonance employees authenticate via AI Intranet (Okta)    │
│ Used for: Admin Portal, Web Chat, API access             │
├─────────────────────────────────────────────────────────┤
│ Layer 2: User → M365 (OAuth 2.0 Delegated)              │
│ Per-user consent for Microsoft Graph API                  │
│ Scopes: Calendars.ReadWrite, Mail.Read, etc.             │
│ Tokens stored in Cortex, auto-refreshed                  │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Platform → Cortex (API Key)                     │
│ Gateway authenticates to Cortex with a shared API key    │
│ Per-request user identity via X-Cortex-User-Id header    │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Platform → LLM (Apollo Proxy)                   │
│ All LLM requests route through Cortex Apollo proxy       │
│ Centralized key management, usage tracking, billing      │
├─────────────────────────────────────────────────────────┤
│ Layer 5: Teams → Bot (Bot Framework Auth)                │
│ Azure Bot Service validates Teams channel tokens         │
│ App ID + App Password per bot registration               │
└─────────────────────────────────────────────────────────┘
```

### 9.2 Agent Access Control

Each agent defines who can interact with it:

```yaml
access:
  owners: ["josh@sonance.com"] # Can edit agent config
  admins: ["elliott@sonance.com"] # Can view metrics, restart
  users: ["*@sonance.com"] # Can chat with the agent
```

The gateway enforces access control before routing messages. In Teams, the `allowFrom` list restricts which Azure AD user IDs can DM the bot.

### 9.3 Tool-Level Authorization

Agents can only call tools they're explicitly allowed:

```yaml
skills:
  cortex:
    mcps: ["m365"] # Only M365 MCP loaded
    tools:
      allow: ["cortex_m365__*"] # Only M365 tools callable
      deny: ["cortex_m365__delete_*"] # Block destructive operations
```

Cortex enforces this at the tool execution layer — even if an agent's LLM hallucinates a tool call to a disallowed tool, Cortex rejects it.

### 9.4 Secrets Management

| Secret              | Storage                                  | Access                           |
| ------------------- | ---------------------------------------- | -------------------------------- |
| Cortex API key      | Azure Container App env vars (encrypted) | Gateway process only             |
| Teams App Passwords | Azure Container App env vars (encrypted) | Gateway process only             |
| AI Intranet API key | Azure Container App env vars (encrypted) | Gateway process only             |
| Anthropic API key   | Cortex-managed (Apollo proxy)            | Never exposed to gateway         |
| User OAuth tokens   | Cortex database (encrypted at rest)      | Cortex process only, per-request |
| Gateway auth token  | Azure Container App env vars (encrypted) | Control UI, API clients          |

No secrets are stored in git, blob storage, or agent workspace directories.

---

## 10. Cortex Integration (Skills & Tools)

### 10.1 How Agents Use Tools

```
User: "Schedule a meeting with Derick tomorrow at 10am"
  │
  ▼
Agent Runtime (OpenClaw):
  1. LLM decides to call cortex_m365__search_people(query="Derick")
  2. Gateway intercepts, adds X-Cortex-User-Id header (Josh's user ID)
  3. Cortex receives call, resolves Josh's M365 OAuth token
  4. Cortex calls Microsoft Graph API on Josh's behalf
  5. Returns results to LLM
  6. LLM calls cortex_m365__get_schedule(emails="derickd@sonance.com")
  7. Same flow: Cortex uses Josh's token to check Derick's free/busy
  8. LLM calls cortex_m365__create_event(...) to create the meeting
  9. Agent responds: "Meeting scheduled with Derick at 10am tomorrow"
```

### 10.2 Per-Agent Tool Profiles

Each agent gets a specific set of MCPs (Micro-Composable Programs) from Cortex:

| Agent     | MCPs Enabled                      | Rationale                                  |
| --------- | --------------------------------- | ------------------------------------------ |
| athena    | m365                              | Personal assistant: calendar, email, files |
| scheduler | m365                              | Meeting coordination specialist            |
| analyst   | m365, github, salesforce, powerbi | Data analysis across systems               |
| ops       | github, devserver                 | DevOps: repos, CI/CD, servers              |

Cortex loads only the MCPs each agent needs, reducing the tool surface area and improving LLM response quality (fewer irrelevant tools to consider).

### 10.3 OAuth Token Flow

```
User signs in (first time):
  Admin Portal → Cortex OAuth endpoint → Microsoft login → Consent → Token stored

Subsequent tool calls:
  Agent → Cortex (with user ID) → Cortex resolves stored token → Auto-refresh if expired → Graph API call
```

Tokens are scoped to delegated permissions (the agent acts as the user, never with app-level access). If a user revokes consent, all tool calls fail gracefully with an "auth required" response.

---

## 11. Agent Communication Protocol

### 11.1 Problem Statement

When multiple agents run in the same platform, they need a way to collaborate. Example scenarios:

- **Scheduler** needs to ask **Athena** what a user's meeting preferences are before booking
- **Analyst** needs to ask **Ops** to pull fresh data from a GitHub repo before generating a report
- A user asks **Athena** to "coordinate with Scheduler to find a time that works for the whole team"

Without a defined protocol, these interactions become ad-hoc hacks that create architectural dead-ends.

### 11.2 Message Bus Architecture

All inter-agent communication goes through a **typed message bus** within the gateway process. Agents never call each other's internals directly.

```
┌──────────────────────────────────────────────────────┐
│                     Gateway Process                    │
│                                                        │
│  ┌──────────┐     ┌──────────────┐     ┌──────────┐  │
│  │  Athena   │────→│  Message Bus  │←────│ Scheduler│  │
│  └──────────┘     │              │     └──────────┘  │
│                   │  Route by    │                    │
│  ┌──────────┐    │  agent_id +  │     ┌──────────┐  │
│  │  Analyst  │────→│  msg type    │←────│   Ops    │  │
│  └──────────┘     └──────┬───────┘     └──────────┘  │
│                          │                            │
│                     ┌────▼────┐                       │
│                     │  Logged  │                       │
│                     │  to DB   │                       │
│                     └─────────┘                       │
└──────────────────────────────────────────────────────┘
```

### 11.3 Message Format

```typescript
interface AgentMessage {
  id: string; // UUID
  from: string; // Source agent ID ("athena")
  to: string; // Target agent ID ("scheduler")
  type: AgentMessageType;
  payload: Record<string, unknown>;
  replyTo?: string; // ID of message being replied to
  userId?: string; // User context (if acting on behalf of a user)
  timeout?: number; // Max wait time in ms (default: 30000)
  timestamp: string; // ISO 8601
}

type AgentMessageType =
  | "query" // Request information (expects a reply)
  | "reply" // Response to a query
  | "notify" // Fire-and-forget notification
  | "delegate" // Hand off a task entirely
  | "error"; // Error response
```

### 11.4 Interaction Patterns

**Pattern 1: Query/Reply (synchronous)**

Scheduler asks Athena for a user's meeting preferences:

```
Scheduler → Bus: {
  type: "query",
  to: "athena",
  payload: { question: "What are Josh's meeting preferences?", userId: "josh-uuid" }
}

Athena → Bus: {
  type: "reply",
  to: "scheduler",
  replyTo: "<query-id>",
  payload: { answer: "Josh prefers mornings, 30-min meetings, no Fridays" }
}
```

The sending agent's LLM processes the reply and continues its task. Timeout: if the target agent doesn't reply within 30s, the sender gets an error message.

**Pattern 2: Delegate (hand-off)**

Athena delegates a scheduling task to Scheduler entirely:

```
Athena → Bus: {
  type: "delegate",
  to: "scheduler",
  payload: {
    task: "Schedule a 1-hour meeting with Derick and Josh tomorrow morning",
    userId: "josh-uuid",
    replyWhenDone: true
  }
}
```

Scheduler executes the full task (including tool calls) and sends a reply with the result.

**Pattern 3: Notify (fire-and-forget)**

Ops notifies Analyst that new data is available:

```
Ops → Bus: {
  type: "notify",
  to: "analyst",
  payload: { event: "data_refresh_complete", dataset: "q4-sales" }
}
```

No reply expected. Analyst processes the notification the next time it handles a conversation.

### 11.5 Authorization & Guardrails

- Agents can only send messages to agents listed in their `agent.yaml` under `spec.collaboration.canContact`
- Each message is logged to the `audit_events` table with full payload (sensitive values redacted)
- An agent receiving a `delegate` message inherits the original user's identity for tool calls (the `userId` propagates through Cortex)
- Rate limit: 10 inter-agent messages per conversation to prevent infinite loops
- Circular delegation detection: if Agent A delegates to B which delegates back to A, the bus rejects with an error

```yaml
# In agent.yaml
spec:
  collaboration:
    canContact: ["scheduler", "ops"] # Agents this agent can message
    acceptFrom: ["*"] # Accept messages from all agents
    maxDelegationDepth: 2 # Max chain: A → B → C (not deeper)
```

### 11.6 Phase 1 vs Phase 2

**Phase 1 (implement now):** Define the `AgentMessage` interface, the bus, and the `query`/`reply` pattern. Even if only one agent exists, the protocol is ready for when the second agent arrives.

**Phase 2 (multi-agent):** Enable `delegate` and `notify` patterns. Build the "roundtable" mode where a user can invoke multiple agents in a Teams group chat, and agents coordinate via the bus.

---

## 12. Admin Portal

### 12.1 Sections

**Dashboard (Landing Page)**

- Agent count, active users, total conversations today
- System health: all-green / degraded / down
- Quick actions: create agent, view alerts

**Org Chart**

- Visual graph showing Sonance employees and agents together
- Agents displayed as team members with roles, skills, and responsible owners
- Data: Cortex user directory + agent registry
- Shows which agents serve which teams/departments

**Command Center**

- **Skills Inventory:** All Cortex MCPs and tools, which agents use which, tool call counts
- **Integration Status:** OAuth connections per user, health of each MCP, error rates
- **Cron Monitor:** Scheduled tasks across all agents, last run, next run, success/failure history
- **Protocol Viewer:** Tool schemas, parameter definitions, version tracking

**Deployment Map**

- Visual topology: which agents are deployed, where they run
- Per-agent health: uptime, response latency, error rate, token consumption
- Storage usage per agent (workspace, memory, cache)
- One-click: restart agent, force-redeploy, view logs

**Agent Manager**

- Create new agent from template or blank
- Edit SOUL.md (with live preview), configure skills and gateway bindings
- Version history and diff view for agent configs
- Enable/disable agents without deleting their data

### 12.2 Access Control

The Admin Portal requires SSO authentication via Sonance AI Intranet. Roles:

| Role           | Permissions                                                    |
| -------------- | -------------------------------------------------------------- |
| Platform Admin | Full access: create/delete agents, manage users, view all data |
| Agent Owner    | Edit their agents' config, view their agents' metrics          |
| Agent Admin    | Restart agents, view metrics, cannot edit config               |
| User           | Chat with agents (no admin portal access)                      |

---

## 13. Security Considerations

### 13.1 Threat Model

| Threat                                                             | Mitigation                                                                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Prompt injection** (user tricks agent into unauthorized actions) | Tool-level allow/deny lists in agent config; Cortex enforces at execution layer; destructive operations require explicit approval         |
| **Data leakage between agents**                                    | Agent workspaces isolated in blob storage; database rows filtered by `agent_id`; inter-agent messages go through authorized bus only      |
| **Data leakage between users**                                     | Per-user memory rows (RLS enforced); user ID propagated on every tool call; Cortex uses per-user OAuth tokens                             |
| **Unauthorized agent access**                                      | Access control in agent.yaml; Teams allowlist per bot; SSO required for web/API                                                           |
| **Token theft**                                                    | OAuth tokens stored in Cortex database (encrypted at rest), never in blob storage or logs; auto-rotation via refresh tokens               |
| **Man-in-the-middle**                                              | All traffic TLS-encrypted; internal container-to-container traffic over localhost                                                         |
| **Container escape**                                               | Azure Container Apps provides hypervisor-level isolation between apps; standard Azure security controls                                   |
| **Inter-agent infinite loop**                                      | A delegates to B delegates back to A                                                                                                      | Rate limit (10 messages/conversation), circular delegation detection, max delegation depth (configurable, default 2) |
| **Supply chain**                                                   | OpenClaw is open-source (auditable); Cortex is internal; dependencies pinned with lockfiles; no arbitrary code execution in agent configs |

### 13.2 Data Residency

- Azure Blob Storage: Azure West US 3 region (same as current deployment)
- Supabase (Postgres): AWS US East 1 (Supabase default; can be configured to a different region at project creation)
- LLM requests go to Anthropic's API (US data centers)
- No data sent to third parties beyond Anthropic (for LLM inference), Microsoft (for Graph API calls), and Supabase (for database storage)
- Conversation transcripts and structured memory are in Supabase (encrypted at rest). File artifacts and workspaces are in Azure Blob Storage (encrypted at rest with Microsoft-managed keys).

### 13.3 Audit Trail

- All tool calls logged to `audit_events` table: timestamp, agent ID, user ID, tool name, parameters (sensitive values redacted), success/failure
- Inter-agent messages logged to `audit_events` with `event_type = 'agent_message'`
- Audit events queryable via Admin Portal (SQL-powered search, filterable by agent/user/date/type)
- Audit events also forwarded to Cortex audit sink (configurable: log file or external SIEM)
- Admin Portal actions logged: who created/modified/deleted agents, config changes

### 13.4 Compliance Notes (For Security Review)

- [ ] Confirm Azure Blob Storage encryption meets Sonance data classification policy
- [ ] Confirm conversation transcript retention (90-day default) meets records policy
- [ ] Confirm Anthropic data processing agreement covers internal business content
- [ ] Review M365 OAuth scopes against least-privilege principle
- [ ] Determine if agent memory (user preferences) constitutes PII under Sonance privacy policy
- [ ] Establish incident response process for agent misbehavior (prompt injection, data leak)

---

## 14. Cost Analysis

### 14.1 Monthly Infrastructure Cost

| Resource                             | Spec                                                | Monthly Cost    |
| ------------------------------------ | --------------------------------------------------- | --------------- |
| Azure Container App (gateway)        | 2 vCPU, 4 GB RAM, always-on, **min 2 replicas**     | ~$180           |
| Azure Container App (cortex sidecar) | 1 vCPU, 2 GB RAM, always-on                         | ~$45            |
| Supabase (Postgres)                  | Pro plan (8 GB database, 250 GB bandwidth)          | ~$25            |
| Azure Blob Storage                   | ~10 GB (agent workspaces, artifacts, SOUL versions) | ~$0.20          |
| Azure Container Registry             | Basic tier, image storage                           | ~$5             |
| Azure Bot Service                    | Standard channels (Teams)                           | Free            |
| Log Analytics                        | Workspace for container logs                        | ~$5             |
| **Infrastructure Total**             |                                                     | **~$260/month** |

### 14.2 LLM Cost (Variable)

| Model                       | Input Cost        | Output Cost         | Est. Monthly (50 users) |
| --------------------------- | ----------------- | ------------------- | ----------------------- |
| Claude Sonnet 4.5           | $3/M input tokens | $15/M output tokens | ~$200-400               |
| Claude Haiku 4.5 (fallback) | $0.80/M input     | $4/M output         | ~$50-100                |

Estimated total with moderate usage: **$350-550/month** (LLM) + **$260/month** (infra) = **~$610-810/month**.

### 14.3 Cost Scaling

Adding agents does NOT increase infrastructure cost (shared container). Cost scales with:

- **User count** → more conversations → more LLM tokens
- **Tool complexity** → more tool calls per conversation → more Cortex CPU
- **Storage** → more users with memory → more blob storage (negligible cost)

At 200 employees with active daily usage, estimated LLM cost: ~$1,500-2,500/month.

---

## 15. Risks & Open Questions

### 15.1 Technical Risks

| Risk                                             | Likelihood | Impact | Mitigation                                                                          |
| ------------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------- |
| Gateway replica failure                          | Low        | Medium | `minReplicas: 2` baseline; rolling updates ensure at least 1 replica always healthy |
| OpenClaw upstream breaking changes               | Low        | Medium | Pin to specific upstream commits; test before merging upstream                      |
| LLM quality regression (Anthropic model updates) | Low        | Medium | Pin model versions; test with staging agent before production rollout               |
| Blob storage latency impacts agent response time | Low        | Low    | Memory/workspace accessed only at conversation start; cached in-process             |
| Teams Bot Framework rate limits                  | Low        | Medium | Azure Bot Service handles throttling; scale gateway replicas if needed              |

### 15.2 Open Questions for Review

1. **High Availability:** ~~Resolved~~ — `minReplicas: 2` adopted as baseline. Cost increase (~$90/mo) is justified for zero-downtime deploys and crash resilience on a platform with daily users.

2. **Data Retention:** What is the appropriate retention period for conversation transcripts? Default proposal: 90 days, configurable per agent.

3. **PII in Memory:** Agent memory files may contain user work patterns, preferences, and names of colleagues. Does this constitute PII? What deletion/export rights apply?

4. **LLM Data Processing:** Conversations are sent to Anthropic for inference. Anthropic's enterprise terms state they don't train on customer data. Is this sufficient, or does Sonance require a BAA or DPA?

5. **Network Segmentation:** Should Cortex be moved to its own Container App with network-level isolation from the gateway? Current design uses localhost sidecar communication.

6. **Disaster Recovery:** Agent configs are in git (recoverable). User memory is in blob storage. What is the RPO/RTO for blob storage? Should we enable geo-redundant storage (GRS)?

7. **Multi-Bot Registration:** Each agent with its own Teams identity requires a separate Azure Bot registration and App Password. Is there an organizational limit or governance process for Bot registrations in Sonance's Azure AD tenant?

---

## 16. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

- Agent schema v1 (YAML types, Zod validation)
- Agent registry (load definitions from `agents/definitions/`)
- File storage abstraction (Azure Blob + local filesystem providers)
- Database layer: Supabase schema (conversations, memory, metrics, cron, audit tables)
- Local dev: SQLite provider mirroring Postgres schema
- Agent communication protocol: `AgentMessage` interface + message bus (query/reply only)
- OpenClaw runtime adapter (maps agent.yaml → OpenClaw config)
- SOUL.md versioning in blob storage (keep last 10 versions)
- Migrate existing Athena agent to new schema format
- **Deliverable:** Existing Athena bot running via new agent schema with database-backed conversations and memory (no user-facing change)

### Phase 2: Multi-Agent + Teams Routing (Weeks 2-3)

- Gateway message router (slash commands → agent, e.g., `/scheduler`, `/analyst`)
- Single-bot Teams routing (Phase 1 pattern: one bot, command dispatch)
- Multi-agent startup in supervisor process
- Per-agent tool profiles via Cortex
- Second agent deployed (e.g., "Scheduler")
- Inter-agent query/reply enabled (Scheduler can ask Athena for user preferences)
- **Deliverable:** Two agents running simultaneously, routable via Teams commands, collaborating via message bus

### Phase 3: Admin Portal — Core (Weeks 3-4)

- Dashboard landing page (agent count, health overview, metrics from `usage_metrics` table)
- Agent Manager (create, edit SOUL.md with live preview, configure skills)
- Basic org chart (agents + owners)
- Conversation browser (searchable via `agent_messages` full-text index)
- **Deliverable:** Web-based agent management with searchable conversation history

### Phase 4: Admin Portal — Command Center (Weeks 4-5)

- Skills inventory (all tools, which agents use which)
- Integration status dashboard (OAuth health, MCP status)
- Cron job monitor (powered by `cron_jobs` + `cron_runs` tables)
- Cross-agent memory search ("what does any agent know about Project X?")
- Usage analytics dashboard (daily active users, token consumption trends)
- **Deliverable:** Operational visibility and analytics across all agents

### Phase 5: Admin Portal — Deployment Map + Multi-Bot (Weeks 5-6)

- Deployment topology visualization
- Per-agent health metrics (uptime, latency, errors, token usage)
- One-click restart/redeploy, SOUL.md rollback from versioned blob storage
- (Optional) Multi-bot Teams routing (separate Azure Bot per agent)
- **Deliverable:** Infrastructure visibility, control, and optional per-agent Teams identities

### Phase 6: Advanced Agent Collaboration + Hardening (Weeks 6-7)

- Agent communication: `delegate` and `notify` patterns
- "Roundtable" mode: multi-agent group chat in Teams
- Portability layer (runtime adapter interface, documented swap process)
- Audit log viewer in admin portal (filterable by agent/user/date/type)
- Documentation for agent creators
- Security review findings addressed
- **Deliverable:** Production-ready platform with multi-agent collaboration

---

## Appendix A: Glossary

| Term                  | Definition                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Agent**             | A configured AI assistant with its own identity, memory, skills, and behavioral instructions                       |
| **Cortex**            | Sonance's internal tool execution backend; manages OAuth, API integrations, and MCP protocol                       |
| **MCP**               | Micro-Composable Program — a Cortex module providing tools for a specific integration (e.g., M365, GitHub)         |
| **OpenClaw**          | Open-source LLM agent runtime; provides tool calling, memory management, and gateway infrastructure                |
| **SOUL.md**           | A markdown file defining an agent's personality, instructions, and behavioral guidelines                           |
| **Gateway**           | A communication channel adapter (Teams, web, API) that routes messages to agents                                   |
| **Apollo Proxy**      | Cortex component that proxies LLM API requests for centralized key management and usage tracking                   |
| **Agent Registry**    | The in-memory index of all defined agents, loaded from YAML definitions at startup                                 |
| **Agent Message Bus** | In-process communication channel for inter-agent query/reply, delegation, and notifications                        |
| **Workspace**         | An agent's persistent file storage area (scratch space, artifacts) in blob storage                                 |
| **Supabase**          | Managed Postgres-as-a-service with REST API, real-time subscriptions, and row-level security                       |
| **RLS**               | Row-Level Security — Postgres feature that restricts which rows a query can access based on the authenticated role |

## Appendix B: Environment Variables

| Variable                      | Purpose                                                       | Where Set         |
| ----------------------------- | ------------------------------------------------------------- | ----------------- |
| `OPENCLAW_GATEWAY_TOKEN`      | Authenticates control UI and API clients to gateway           | Container App env |
| `CORTEX_API_KEY`              | Authenticates gateway to Cortex                               | Container App env |
| `SONANCE_CORTEX_API_KEY`      | Authenticates sonance-cortex plugin to Cortex                 | Container App env |
| `AI_INTRANET_URL`             | SSO endpoint for employee authentication                      | Container App env |
| `AI_INTRANET_APP_ID`          | SSO application identifier                                    | Container App env |
| `AI_INTRANET_APP_API_KEY`     | SSO application secret                                        | Container App env |
| `CORTEX_SUPABASE_URL`         | Supabase project for file sync features                       | Container App env |
| `CORTEX_SUPABASE_ANON_KEY`    | Supabase anonymous key                                        | Container App env |
| `ATHENA_SUPABASE_URL`         | Athena Supabase project URL                                   | Container App env |
| `ATHENA_SUPABASE_SERVICE_KEY` | Supabase service role key (full DB access for gateway)        | Container App env |
| `ATHENA_SUPABASE_ANON_KEY`    | Supabase anon key (RLS-restricted, for Admin Portal frontend) | Container App env |
| `MSTEAMS_APP_ID`              | Azure Bot registration App ID (per bot)                       | Container App env |
| `MSTEAMS_APP_PASSWORD`        | Azure Bot registration secret (per bot)                       | Container App env |
| `MSTEAMS_TENANT_ID`           | Azure AD tenant for Teams                                     | Container App env |

---

_This document is a draft for internal review. Please direct feedback to Josh or submit comments via the Athena GitHub repository._
