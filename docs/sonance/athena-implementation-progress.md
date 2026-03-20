# Athena Platform: Implementation Progress

**Last updated:** March 17, 2026
**Reference plan:** [`athena-platform-proposal.md`](./athena-platform-proposal.md)
**Current branch:** `josh-staging`

---

## Summary

| Phase | Title                                     | Status      |
| ----- | ----------------------------------------- | ----------- |
| 1     | Foundation                                | ✅ Complete |
| 2     | Multi-Agent + Teams Routing               | ✅ Complete |
| 3     | Admin Portal — Core                       | ✅ Complete |
| 4     | Admin Portal — Command Center             | ✅ Complete |
| 5     | Admin Portal — Deployment Map + Multi-Bot | ✅ Complete |
| 6     | Advanced Agent Collaboration + Hardening  | ✅ Complete |

---

## Phase 1: Foundation ✅ Complete

Completed and pushed to staging in commit `e67e52b94`.

- [x] Agent schema v1 — YAML types, Zod validation (`agents/definitions/`)
- [x] Agent registry — loads definitions at startup, in-memory index
- [x] File storage abstraction — Azure Blob provider + local filesystem provider
- [x] Database layer — Supabase schema: `conversations`, `memory`, `usage_metrics`, `cron_jobs`, `cron_runs`, `audit_events`
- [x] Local dev SQLite provider mirroring Postgres schema
- [x] Agent communication protocol — `AgentMessage` interface + message bus (query/reply)
- [x] OpenClaw runtime adapter — maps `agent.yaml` → OpenClaw config
- [x] SOUL.md versioning in Azure Blob (keeps last 10 versions)
- [x] Athena migrated to new schema format

---

## Phase 2: Multi-Agent + Teams Routing ✅ Complete

All 6 items implemented and verified end-to-end in Teams.

- [x] Gateway message router — slash commands (`/scheduler`, `!scheduler`, `@scheduler`) + intent keywords
- [x] Single-bot Teams routing — fixed session key bug (was appending `:scheduler` instead of replacing agent ID segment)
- [x] Multi-agent startup in supervisor process
- [x] Per-agent tool profiles via Cortex — specialist agents get `profile: "sonance"` (~13 tools) instead of global `"full"` (295+ tools)
- [x] Second agent deployed — Scheduler agent with M365 calendar tools
- [x] Inter-agent query/reply — `ask_agent` tool registered, bus subscriptions wired on startup, ACLs from `collaboration.canContact`

**Bugs found and fixed during testing:**

- Profile store defaulted to Docker `/data/profiles` path → falls back to `~/.openclaw/profiles/` on Mac
- Installed plugin at `~/.openclaw/extensions/msteams/` was out of sync with repo → synced
- `Cannot find module '../../../../src/platform/router.js'` from installed plugin → lazy `require()` with `ATHENA_REPO_ROOT`
- Bot Framework turn context expired before agent finished → proactive messaging fallback added to reply dispatcher
- Scheduler loading wrong SOUL.md — per-user profile workspace override was masking agent's own workspace → removed workspace override for non-default agents
- Platform agents blocked by guard condition in `sonance-defaults.ts` (`if (!Array.isArray(existingAgentsList) || existingAgentsList.length === 0)`) → removed guard, always merge platform agents alongside cortex bridge agents
- Duplicate opening message when context expired mid-send → tracked already-sent messages before proactive fallback

**Files changed (Phase 2):**

- `deploy/msteams-plugin/src/monitor-handler/message-handler.ts`
- `deploy/msteams-plugin/src/messenger.ts`
- `deploy/msteams-plugin/src/profile-store.ts`
- `deploy/msteams-plugin/src/reply-dispatcher.ts`
- `deploy/msteams-plugin/src/policy.ts`
- `agents/definitions/scheduler/agent.yaml` — added `routing.intentKeywords` and priority
- `src/platform/agent-bus-tool.ts` — fixed caller detection, self-query guard
- `src/platform/adapter.ts` — bus subscriptions, tool allowlist, removed platform agents guard
- `src/config/sonance-defaults.ts` — removed guard condition blocking platform agent overlay
- `extensions/sonance-cortex/index.ts` — registered `ask_agent` tool
- `agents/definitions/scheduler/SOUL.md` — updated for direct user interaction mode

---

## Phase 3: Admin Portal — Core ✅ Complete

All 4 items complete.

- [x] Dashboard landing page — Identity view with activity stats (AI requests, tokens, cost, tool calls, MCPs used, active days), platform agent counts (Agents, Active Agents, Errors Today), online/offline status, and Cortex MCP connections grid
- [x] Agent Manager (`/platform/agents`) — Jira-style table (Name, Model, Role, Status, Convos, Msgs, Errors), SOUL.md editor with edit/save/cancel, agent detail modal (stats, last active, gateways), create agent, delete agent
- [x] Basic org chart (`/command-center`) — agent hierarchy (primary orchestrator → sub-agents), Sonance departments panel
- [x] Conversation browser (`/platform/conversations`) — filter by agent/user/gateway, full-text message search, conversation detail view

**UI changes made in this session (Claude Code):**

- Flat sidebar navigation (no section headers or dividers)
- New nav structure: Dashboard, Command Center, Agents, Cortex Connections, Usage, Chat
- Platform stats moved to Identity tab (not Classic/legacy dashboard)
- Cortex Connections page, Command Center page, platform-agents rewrite (Jira-style table)
- Sidebar: removed Resources/Docs link

---

## Phase 4: Admin Portal — Command Center ✅ Complete

All 5 items complete.

- [x] Skills inventory — per-agent skills panel in agent modal (MCPs + allowed tools list sourced from `agent.yaml` `skills.cortex`)
- [x] Integration status dashboard — Cortex Connections page (`/cortex`) shows all 11 available MCPs with OAuth connection status, connect buttons, account email
- [x] Cron job monitor (`/platform/cron`) — table of all scheduled jobs with schedule, last/next run, status; recent runs history table
- [x] Memory browser (`/platform/memory`) — filterable memory card grid with per-entry delete
- [x] Audit log viewer (`/platform/audit`) — filterable audit table by agent and event type
- [x] Usage analytics dashboard — Usage tab with agent-level 7-day metrics table (date, agent, convos, messages, tools, tokens, errors)

---

## Phase 5: Admin Portal — Deployment Map + Multi-Bot ✅ Complete

All implemented items complete. Multi-bot Teams routing deferred (remains optional).

- [x] SOUL.md version history UI in agent modal — loads versions, shows list, one-click restore with confirmation
- [x] `athena.platform.agent.soul.versions` + `athena.platform.agent.soul.rollback` gateway methods
- [x] Deployment topology view (`/platform/deployment`) — per-agent cards with status, health metrics, model, gateways, connected MCPs, inter-agent ACLs
- [x] Per-agent uptime / latency tracking — `agent_health` table (SQLite + Postgres), `persistHealthSample` fire-and-forget, `avgTurnDurationMs` in `AgentStats`, latency tile + health panel in agent modal (avg, p95, per-turn colored dots)
- [x] One-click restart/redeploy — `athena.platform.restart` gateway method calls Azure CLI (`az containerapp revision restart`); in LOCAL mode returns informational message; "Restart Gateway" button in deployment view header with confirmation dialog
- [ ] (Optional) Multi-bot Teams routing — separate Azure Bot per agent

**New tables added (Phase 5):**

- `agent_health` — `id`, `agent_id`, `conversation_id`, `user_id`, `turn_duration_ms`, `response_latency_ms`, `status` (success/error/timeout), `error_code`, `tokens_input`, `tokens_output`, `model`, `created_at`

**New Supabase project provisioned (Phase 5):**

- `uupmviegcginkepemnou.supabase.co` — dedicated Athena Platform DB (separate from Cortex file-sync)
- `ATHENA_SUPABASE_URL` + `ATHENA_SUPABASE_SERVICE_ROLE_KEY` added to `.env` and `deploy/.env`

**Files changed (Phase 5):**

- `src/platform/database/schema.sql` — `agent_health` table + indexes
- `src/platform/database/migrations/001_initial_schema.sql` — Postgres equivalent (run against new Supabase project)
- `src/platform/database/types.ts` — `AgentHealthSample`, `AgentHealthFilter`, `avgTurnDurationMs` on `AgentStats`
- `src/platform/database/sqlite-provider.ts` — `logHealthSample`, `getHealthSamples`, avg subquery in `getAgentStats`
- `src/platform/database/supabase-provider.ts` — same methods via PostgREST
- `src/platform/persistence.ts` — `persistHealthSample` fire-and-forget
- `src/auto-reply/reply/agent-runner.ts` — instruments each turn with `persistHealthSample`
- `src/platform/gateway-methods.ts` — `athena.platform.agent.health` + `athena.platform.restart` methods
- `ui/src/ui/controllers/platform.ts` — `loadAgentHealthSamples`, `restartGateway`, state fields
- `ui/src/ui/app-view-state.ts` — `platformHealthSamples*`, `platformRestart*` fields
- `ui/src/ui/app.ts` — `@state()` properties for health samples + restart
- `ui/src/ui/app-render.ts` — wires restart props to deployment view
- `ui/src/ui/views/platform-deployment.ts` — "Restart Gateway" button with confirmation dialog + result banner

---

## Phase 6: Advanced Agent Collaboration + Hardening ✅ Complete

All five work streams implemented.

- [x] **6.5** Security: ACL at bus dispatch layer, `athena.platform.*` auth gate, SOUL.md injection guard
- [x] **6.1** Agent communication: `delegate` and `notify` patterns alongside existing `query/reply`
- [x] **6.4** Documentation: `agent-creator-guide.md`, `agent-yaml-reference.md`, annotated `agent.yaml` example
- [x] **6.2** Roundtable mode — multi-agent group chat; `@athena @scheduler msg` fans out in Teams
- [x] **6.3** Portability layer — `AgentRuntime` interface, `OpenClawRuntime`, `MockRuntime` for tests

**New files (Phase 6):**

- `src/platform/roundtable.ts` — `detectRoundtableAgents`, `coordinateRoundtable`, `formatRoundtableResponse`
- `src/platform/runtime.ts` — `AgentRuntime` interface + `OpenClawRuntime` + `MockRuntime`
- `docs/sonance/agent-creator-guide.md` — end-to-end agent creation guide
- `docs/sonance/agent-yaml-reference.md` — full YAML field reference

**New database tables (Phase 6):**

- `roundtable_sessions` — session ID, user ID, participants JSONB, responses JSONB, duration

**Files changed (Phase 6):**

- `src/platform/message-bus.ts` — `delegate()` method, all three patterns documented
- `src/platform/agent-bus-tool.ts` — `createDelegateAgentToolDef`, `createNotifyAgentToolDef`
- `src/platform/gateway-methods.ts` — `athena.platform.restart` method; `requireAuth()` gate on all methods; `athena.platform.roundtable` method; SOUL.md content guard
- `src/platform/database/migrations/001_initial_schema.sql` — `roundtable_sessions` table
- `deploy/msteams-plugin/src/monitor-handler/message-handler.ts` — roundtable detection + fan-out before single-agent routing
- `extensions/sonance-cortex/index.ts` — registers `delegate_to_agent`, `notify_agent` tools; sets `OpenClawRuntime` as global runtime on startup
- `agents/definitions/scheduler/agent.yaml` — fully annotated with inline comments as a living example

---

## Phase 6 Plan

### Overview

Phase 6 hardens the platform for organization-wide rollout. The five work streams are independent and can be tackled in any order, but the recommended sequence below minimizes risk.

---

### 6.1 — `delegate` and `notify` Communication Patterns

**Goal:** Extend inter-agent communication beyond the current `query/reply` pattern.

**Background:** The existing `ask_agent` tool does a synchronous query/reply over the in-process message bus. Two new patterns are needed:

- **`delegate`** — fire-and-forget: orchestrator hands off a task to a specialist and moves on. The specialist replies asynchronously when done (proactive message back to the user, or a callback to the orchestrator).
- **`notify`** — broadcast: an agent sends an informational event to one or more agents (e.g., "calendar event created", "user mentioned project X"). Recipients decide whether to act.

**Implementation steps:**

1. Add `MessageType.DELEGATE` and `MessageType.NOTIFY` to `AgentMessage` in `src/platform/agent-bus.ts`
2. Register two new tools in `extensions/sonance-cortex/index.ts`:
   - `delegate_to_agent(agentId, task, context?)` — sends a DELEGATE message; returns immediately
   - `notify_agent(agentId, event, payload?)` — sends a NOTIFY message; no reply expected
3. Add ACL check: `collaboration.canDelegate` and `collaboration.canNotify` in `agent.yaml` (reuse `canContact` shape)
4. For DELEGATE: the specialist processes the task and calls `proactiveReply` to send the result back to the original user/conversation
5. For NOTIFY: bus subscribers can register handlers; no reply path required
6. Add `delegate` and `notify` to `AgentMessage` interface in `types.ts`
7. Update SOUL.md for Athena and Scheduler to document these capabilities
8. Write E2E test: orchestrator delegates a calendar task to Scheduler; Scheduler proactively replies

**Files to change:** `src/platform/agent-bus.ts`, `src/platform/agent-bus-tool.ts`, `extensions/sonance-cortex/index.ts`, `agents/definitions/*/agent.yaml`

---

### 6.2 — Roundtable Mode (Multi-Agent Group Chat in Teams)

**Goal:** Let a user address multiple agents in a single Teams thread and have them collaborate visibly.

**Background:** Currently each message is routed to exactly one agent. Roundtable allows a user to type `@athena @scheduler let's plan next week` and get coordinated responses from both.

**Implementation steps:**

1. Add `routing.roundtable: true` flag to `agent.yaml` (opt-in per agent)
2. Extend `message-handler.ts` to detect multi-mention syntax and create a Roundtable session
3. Create `RoundtableSession` class in `src/platform/roundtable.ts`:
   - Receives the user message
   - Fans out to all mentioned agents via the message bus (DELEGATE pattern from 6.1)
   - Collects responses and sends them back to Teams in turn order
   - Handles partial failures (one agent doesn't respond — timeout + fallback)
4. Add `roundtable_session` table to database (tracks session ID, agents, messages, status)
5. Admin portal: add Roundtable Sessions to the Conversations browser (badge/label to distinguish)
6. Test with 2 agents (Athena + Scheduler) in a real Teams thread

**Files to change:** `deploy/msteams-plugin/src/monitor-handler/message-handler.ts`, new `src/platform/roundtable.ts`, `src/platform/database/schema.sql`, `agents/definitions/*/agent.yaml`

---

### 6.3 — Portability Layer

**Goal:** Make it possible to swap out OpenClaw for a different agent runtime without rewriting the platform.

**Background:** The platform currently has OpenClaw-specific code in `src/platform/adapter.ts` and the Cortex plugin. A portability layer defines a stable interface that different runtimes implement.

**Implementation steps:**

1. Define `AgentRuntime` interface in `src/platform/runtime.ts`:
   ```typescript
   interface AgentRuntime {
     startAgent(def: AgentDefinition): Promise<void>;
     stopAgent(agentId: string): Promise<void>;
     sendMessage(agentId: string, message: IncomingMessage): Promise<AgentResponse>;
     getStatus(agentId: string): AgentRuntimeStatus;
   }
   ```
2. Wrap current OpenClaw adapter behind this interface (`OpenClawRuntime implements AgentRuntime`)
3. Update `adapter.ts` to use `AgentRuntime` instead of calling OpenClaw APIs directly
4. Write a `MockRuntime` for testing (returns canned responses)
5. Document the swap process: what to implement, how to register, how to test
6. Add `runtime` field to `agent.yaml` (optional, defaults to `openclaw`)

**Files to change:** New `src/platform/runtime.ts`, refactor `src/platform/adapter.ts`

---

### 6.4 — Documentation for Agent Creators

**Goal:** Enable non-engineering employees to create and publish new agents with minimal support.

**Deliverables:**

1. **`docs/sonance/agent-creator-guide.md`** — end-to-end guide:
   - What is an agent, what can it do
   - `agent.yaml` field reference (all fields, examples, defaults)
   - SOUL.md authoring guide (tone, structure, what goes in vs. what goes in tools)
   - How to deploy: copy `agents/definitions/scheduler/` as a template, edit YAML + SOUL.md, restart gateway
   - How to use the Admin Portal: create agent, edit SOUL, view conversations, check errors
   - How to register a cron job, add M365 access, add a custom MCP
2. **`docs/sonance/agent-yaml-reference.md`** — full schema reference generated from Zod types
3. **Inline YAML comments** in `agents/definitions/scheduler/agent.yaml` as a living example
4. Admin portal: "New Agent" wizard UI (guided form instead of raw YAML)

**Files to create/change:** `docs/sonance/agent-creator-guide.md`, `docs/sonance/agent-yaml-reference.md`, `ui/src/ui/views/platform-agents.ts` (wizard modal)

---

### 6.5 — Security Review

**Goal:** Address findings before expanding to all Sonance employees.

**Scope:**

| Area                      | Risk                                                                                       | Mitigation                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Gateway token exposure    | `OPENCLAW_GATEWAY_TOKEN` in `.env` — if leaked, full API access                            | Rotate before org-wide deploy; add token scoping (read-only vs admin)                                    |
| `ask_agent` ACL bypass    | Bus ACL checked only at tool registration; a compromised agent could call the bus directly | Move ACL check to bus dispatch layer (not just tool layer)                                               |
| SOUL.md injection         | An admin editing SOUL.md can inject prompt-level instructions                              | Add content policy check on save; log all SOUL.md changes to audit trail (already have audit events)     |
| Supabase service role key | Service role key in `.env` has full DB access                                              | Migrate to per-table RLS + anon key for reads; service role only for writes                              |
| M365 token storage        | Per-user tokens stored in Cortex profile store                                             | Verify tokens are encrypted at rest; rotate on logout                                                    |
| Audit log integrity       | Audit events writable via `persistAudit` from any code path                                | Consider append-only audit table (no UPDATE/DELETE via service role)                                     |
| Admin portal auth         | Portal connects directly to gateway WebSocket — no auth layer                              | Add gateway-level auth check for `athena.platform.*` methods; reuse `OPENCLAW_GATEWAY_TOKEN` or Okta SSO |

**Implementation steps:**

1. Move ACL enforcement to `AgentMessageBus.dispatch()` in `src/platform/agent-bus.ts`
2. Add `athena.platform.*` method auth gate in `gateway-methods.ts` — check bearer token against `OPENCLAW_GATEWAY_TOKEN`
3. Rotate secrets before org-wide launch (gateway token, Supabase keys)
4. Add SOUL.md content length + basic injection pattern check on save
5. Document RLS migration plan for Supabase (Phase 7 / future)

**Files to change:** `src/platform/agent-bus.ts`, `src/platform/gateway-methods.ts`

---

### Recommended Phase 6 Sequence

1. **6.5 Security Review** (items 1–2: ACL hardening + portal auth gate) — do this first, before expanding access
2. **6.1 Delegate + Notify** — unlocks real agent collaboration; used by 6.2
3. **6.4 Documentation** — write the agent creator guide while the patterns are fresh
4. **6.2 Roundtable** — depends on delegate pattern from 6.1
5. **6.3 Portability Layer** — lowest urgency; refactor only when a runtime swap is actually planned

---

## Known Issues / Open Items

| Issue                                            | Area               | Notes                                                                                                      |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `cortex.tools.list` gateway method missing       | Cortex Connections | Page falls back to static AVAILABLE_MCPS list; functional but won't auto-discover new integrations         |
| `cortex.connections.list` gateway method missing | Cortex Connections | Uses `connections.list` from dashboard as fallback                                                         |
| Scheduler inter-agent responses are stubs        | Phase 2            | `ask_agent` bus handler returns context-aware stub; full LLM-backed responses deferred to Phase 6          |
| No auto-restart on Mac                           | Infrastructure     | Gateway runs via ngrok locally, not deployed to Azure; must be manually restarted if it dies               |
| Per-user M365 token isolation                    | Security           | ✅ Fixed in commit `c01701f99` — prevents cross-user calendar/email leakage                                |
| `az` CLI required for Restart Gateway            | Deployment         | Restart Gateway button calls `az containerapp revision restart`; requires Azure CLI installed + `az login` |

---

## Next Up (Suggested Order)

1. **Deploy to Azure** (Infrastructure) — replace ngrok with production Azure Container Apps deployment so the bot runs 24/7 without needing the Mac on
2. **Test roundtable end-to-end** — `@athena @scheduler let's plan next week` in a real Teams thread; verify both agents respond
3. **Supabase RLS migration** (Phase 6.5 remainder) — per-table Row Level Security, switch portal to anon key for reads
4. **New Agent wizard UI** (Phase 6.4 stretch) — guided modal in Admin Portal instead of raw YAML editing
