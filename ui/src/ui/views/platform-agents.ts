/**
 * Platform Agents View
 *
 * Jira-style table of all platform agents with:
 *  1. Stats bar
 *  2. Agents table with row actions
 *  3. Glass-morphism agent detail modal
 *  4. Create / Delete modals
 */
import { html, nothing } from "lit";
import type { MCPConnection } from "../controllers/agents.ts";
import type {
  AgentStatsEntry,
  PlatformAgent,
  PlatformErrorEvent,
  PlatformHealthSample,
  PlatformMetric,
  PlatformStats,
} from "../controllers/platform.ts";
import type { PluginToolGroup } from "./agents-utils.ts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type AgentManagerViewProps = {
  loading: boolean;
  error: string | null;
  agents: PlatformAgent[] | null;
  selectedAgentId: string | null;
  soulEditing: boolean;
  soulDraft: string | null;
  soulSaving: boolean;
  soulError: string | null;
  showCreateModal: boolean;
  createError: string | null;
  deleteConfirmId: string | null;
  stats: PlatformStats | null;
  agentStats: AgentStatsEntry[] | null;
  metrics: PlatformMetric[] | null;
  cortexToolGroups: PluginToolGroup[] | null;
  cortexConnections: MCPConnection[] | null;
  onRefresh: () => void;
  onSelectAgent: (id: string | null) => void;
  onEditSoul: () => void;
  onSoulDraftChange: (content: string) => void;
  onSaveSoul: (agentId: string, content: string) => void;
  onCancelEdit: () => void;
  onUpdateConfig: (agentId: string, updates: Record<string, unknown>) => void;
  onShowCreateModal: (show: boolean) => void;
  onCreateAgent: (params: { name: string; model?: string }) => void;
  onDeleteAgent: (agentId: string) => void;
  onConfirmDelete: (agentId: string | null) => void;
  onOAuthConnect: (mcpName: string) => void;
  soulVersions: Array<{ version: number; createdAt: string }> | null;
  soulVersionsLoading: boolean;
  soulVersionsAgentId: string | null;
  onLoadVersions: (agentId: string) => void;
  onRestoreVersion: (agentId: string, version: number) => void;
  onViewErrors: (agentId: string) => void;
  agentErrors: PlatformMetric[] | null;
  agentErrorsLoading: boolean;
  agentErrorsAgentId: string | null;
  onLoadErrors: (agentId: string) => void;
  errorEvents: PlatformErrorEvent[] | null;
  errorEventsLoading: boolean;
  errorEventsAgentId: string | null;
  onLoadErrorEvents: (agentId: string) => void;
  healthSamples: PlatformHealthSample[] | null;
  healthSamplesLoading: boolean;
  healthSamplesAgentId: string | null;
  onLoadHealthSamples: (agentId: string) => void;
};

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function renderAgentManager(props: AgentManagerViewProps) {
  // Filter out cortex/mcp bridge agents from main table
  const allAgents = props.agents ?? [];
  const platformAgents = allAgents.filter(
    (a) => !a.id.startsWith("cortex") && !a.id.startsWith("mcp"),
  );

  const selectedAgent = allAgents.find((a) => a.id === props.selectedAgentId) ?? null;

  return html`
    ${props.showCreateModal ? renderCreateModal(props) : nothing}
    ${props.deleteConfirmId ? renderDeleteDialog(props) : nothing}
    ${selectedAgent ? renderAgentModal(props, selectedAgent) : nothing}

    <!-- Page header -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <div class="page-title">Agents</div>
        <div class="page-sub">View and manage AI agent definitions, personalities, and tool profiles.</div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button
          class="btn btn--sm"
          ?disabled=${props.loading}
          @click=${() => props.onRefresh()}
        >${props.loading ? "Loading…" : "Refresh"}</button>
        <button
          class="btn btn--sm primary"
          @click=${() => props.onShowCreateModal(true)}
        >+ New Agent</button>
      </div>
    </div>

    ${props.error ? html`<div class="pill danger" style="margin-bottom: 16px;">${props.error}</div>` : nothing}

    ${renderStatsBar(props, platformAgents)}
    ${renderAgentsTable(props, platformAgents)}
    ${renderUsageSection(props)}
  `;
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function renderStatsBar(props: AgentManagerViewProps, agents: PlatformAgent[]) {
  const s = props.stats;
  const errorAgents = props.agentStats?.filter((a) => (a.errors ?? 0) > 0).length ?? 0;
  const errorsToday = s?.errorsToday ?? 0;

  return html`
    <div style="
      display: flex; flex-wrap: wrap; gap: 8px;
      margin-bottom: 24px;
    ">
      ${renderStatPill("Total Agents", String(agents.length), false)}
      ${renderStatPill("Healthy", String(agents.length - errorAgents), false, true)}
      ${renderStatPill("Errors Today", String(errorsToday), errorsToday > 0)}
      ${
        s
          ? html`
        ${renderStatPill("Conversations", fmt(s.conversations), false)}
        ${renderStatPill("Messages", fmt(s.messages), false)}
      `
          : nothing
      }
    </div>
  `;
}

function renderStatPill(label: string, value: string, danger: boolean, success = false) {
  return html`
    <div style="
      display: flex; align-items: center; gap: 8px;
      padding: 6px 14px;
      border-radius: 20px;
      border: 1px solid ${danger ? "rgba(239, 68, 68, 0.3)" : success ? "rgba(34, 197, 94, 0.25)" : "var(--border, #333)"};
      background: ${danger ? "rgba(239, 68, 68, 0.07)" : success ? "rgba(34, 197, 94, 0.07)" : "var(--card, #242a31)"};
      font-size: 13px;
    ">
      <span style="
        font-weight: 700; font-variant-numeric: tabular-nums;
        color: ${danger ? "var(--danger, #ef4444)" : success ? "#22c55e" : "var(--accent, #00A3E1)"};
      ">${value}</span>
      <span style="opacity: 0.5;">${label}</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Agents table
// ---------------------------------------------------------------------------

function renderAgentsTable(props: AgentManagerViewProps, agents: PlatformAgent[]) {
  if (props.loading && agents.length === 0) {
    return html`
      <div style="opacity: 0.4; padding: 32px 0; text-align: center">Loading agents…</div>
    `;
  }

  if (agents.length === 0) {
    return html`
      <div
        style="
          padding: 48px 24px;
          text-align: center;
          opacity: 0.4;
          border: 1px dashed var(--border, #444);
          border-radius: 12px;
          margin-bottom: 32px;
        "
      >
        No platform agents found. Create one to get started.
      </div>
    `;
  }

  return html`
    <div style="
      border: 1px solid var(--border, #333);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 32px;
    ">
      <!-- Table header -->
      <div style="
        display: grid;
        grid-template-columns: 2fr 1.5fr 130px 120px 80px 80px 80px 44px;
        gap: 0;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border, #333);
        background: rgba(255,255,255,0.02);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        opacity: 0.45;
      ">
        <div>Name</div>
        <div>Model</div>
        <div>Role</div>
        <div>Status</div>
        <div style="text-align: right;">Convos</div>
        <div style="text-align: right;">Msgs</div>
        <div style="text-align: right;">Errors</div>
        <div></div>
      </div>

      <!-- Rows -->
      ${agents.map((agent, i) => renderAgentRow(props, agent, i < agents.length - 1))}
    </div>
  `;
}

function renderAgentRow(props: AgentManagerViewProps, agent: PlatformAgent, hasBorder: boolean) {
  const stat = props.agentStats?.find((s) => s.agentId === agent.id);
  const hasErrors = (stat?.errors ?? 0) > 0;
  const isSelected = props.selectedAgentId === agent.id;

  return html`
    <div style="
      display: grid;
      grid-template-columns: 2fr 1.5fr 130px 120px 80px 80px 80px 44px;
      gap: 0;
      padding: 12px 16px;
      align-items: center;
      ${hasBorder ? "border-bottom: 1px solid var(--border, #333);" : ""}
      background: ${isSelected ? "rgba(0, 163, 225, 0.05)" : "var(--card, #242a31)"};
      transition: background 0.15s;
    "
    @mouseenter=${(e: MouseEvent) => {
      if (!isSelected) {
        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
      }
    }}
    @mouseleave=${(e: MouseEvent) => {
      if (!isSelected) {
        (e.currentTarget as HTMLElement).style.background = "var(--card, #242a31)";
      }
    }}
    >
      <!-- Name + ID -->
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span style="font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${agent.displayName}
        </span>
        <span style="font-size: 10px; opacity: 0.4; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${agent.id}
        </span>
      </div>

      <!-- Model -->
      <div style="font-size: 11px; font-family: monospace; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${shortModel(agent.model?.primary ?? "")}
      </div>

      <!-- Role badge -->
      <div>
        <span style="
          display: inline-block;
          padding: 2px 8px; border-radius: 10px;
          font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
          background: ${agent.role === "orchestrator" ? "rgba(0, 163, 225, 0.15)" : "rgba(255,255,255,0.05)"};
          color: ${agent.role === "orchestrator" ? "var(--accent, #00A3E1)" : "var(--text-muted, #888)"};
          border: 1px solid ${agent.role === "orchestrator" ? "rgba(0, 163, 225, 0.3)" : "var(--border, #444)"};
        ">${agent.role ?? "—"}</span>
      </div>

      <!-- Status -->
      <div>
        <span style="
          display: inline-flex; align-items: center; gap: 5px;
          padding: 2px 10px; border-radius: 10px;
          font-size: 11px; font-weight: 600;
          background: ${hasErrors ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)"};
          color: ${hasErrors ? "var(--danger, #ef4444)" : "#22c55e"};
          border: 1px solid ${hasErrors ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)"};
        ">
          <span style="width: 5px; height: 5px; border-radius: 50%; background: currentColor;"></span>
          ${hasErrors ? "error" : "healthy"}
        </span>
      </div>

      <!-- Conversations -->
      <div style="text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; opacity: 0.8;">
        ${stat ? fmt(stat.conversations) : "—"}
      </div>

      <!-- Messages -->
      <div style="text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; opacity: 0.8;">
        ${stat ? fmt(stat.messages) : "—"}
      </div>

      <!-- Errors -->
      <div style="
        text-align: right; font-size: 13px; font-variant-numeric: tabular-nums;
        color: ${hasErrors ? "var(--danger, #ef4444)" : "inherit"};
        opacity: ${hasErrors ? 1 : 0.4};
      ">
        ${stat?.errors ?? "—"}
      </div>

      <!-- View button -->
      <div style="display: flex; justify-content: center;">
        <button
          style="
            background: none; border: 1px solid var(--border, #444);
            border-radius: 6px; padding: 5px 6px; cursor: pointer;
            color: var(--text, #e0e0e0); opacity: 0.6;
            display: flex; align-items: center; justify-content: center;
            transition: opacity 0.15s, border-color 0.15s;
          "
          title="View agent"
          @click=${() => props.onSelectAgent(agent.id)}
          @mouseenter=${(e: MouseEvent) => {
            const el = e.currentTarget as HTMLElement;
            el.style.opacity = "1";
            el.style.borderColor = "var(--accent, #00A3E1)";
          }}
          @mouseleave=${(e: MouseEvent) => {
            const el = e.currentTarget as HTMLElement;
            el.style.opacity = "0.6";
            el.style.borderColor = "var(--border, #444)";
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Agent detail modal (glass morphism)
// ---------------------------------------------------------------------------

function renderAgentModal(props: AgentManagerViewProps, agent: PlatformAgent) {
  const stat = props.agentStats?.find((s) => s.agentId === agent.id);

  return html`
    <!-- Backdrop -->
    <div
      style="
        position: fixed; inset: 0; z-index: 500;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
      "
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          props.onSelectAgent(null);
        }
      }}
    >
      <!-- Modal panel -->
      <div style="
        position: relative;
        width: 100%; max-width: 860px; max-height: 90vh;
        overflow: hidden;
        border-radius: 16px;
        border: 1px solid var(--border, #444);
        background: rgba(24, 28, 35, 0.92);
        backdrop-filter: blur(20px);
        display: flex; flex-direction: column;
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.04);
      ">
        <!-- Modal header -->
        <div style="
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid var(--border, #333);
          flex-shrink: 0;
        ">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div>
              <div style="font-size: 20px; font-weight: 800;">${agent.displayName}</div>
              <div style="font-size: 12px; opacity: 0.4; font-family: monospace; margin-top: 2px;">${agent.id}</div>
            </div>
            <span style="
              padding: 3px 10px; border-radius: 12px;
              font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
              background: ${agent.role === "orchestrator" ? "rgba(0, 163, 225, 0.15)" : "rgba(255,255,255,0.06)"};
              color: ${agent.role === "orchestrator" ? "var(--accent, #00A3E1)" : "var(--text-muted, #888)"};
              border: 1px solid ${agent.role === "orchestrator" ? "rgba(0,163,225,0.3)" : "var(--border,#444)"};
            ">${agent.role ?? "agent"}</span>
          </div>
          <button
            style="
              background: rgba(255,255,255,0.06); border: 1px solid var(--border, #444);
              border-radius: 8px; width: 32px; height: 32px;
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; color: var(--text, #e0e0e0);
              font-size: 16px; flex-shrink: 0;
              transition: background 0.15s;
            "
            @click=${() => props.onSelectAgent(null)}
          >✕</button>
        </div>

        <!-- Modal body (scrollable) -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; flex: 1; overflow: hidden; min-height: 0;">

          <!-- Left: overview + stats -->
          <div style="padding: 24px; overflow-y: auto; border-right: 1px solid var(--border, #333);">
            <!-- Overview stats -->
            ${
              stat
                ? html`
              <div style="
                display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
                margin-bottom: 24px;
              ">
                ${renderModalStat("Conversations", fmt(stat.conversations))}
                ${renderModalStat("Messages", fmt(stat.messages))}
                ${renderModalStat("Tokens", fmt(stat.tokensInput + stat.tokensOutput))}
                ${renderModalStat("Errors", String(stat.errors ?? 0), (stat.errors ?? 0) > 0, (stat.errors ?? 0) > 0 ? () => props.onLoadErrorEvents(agent.id) : undefined)}
                ${renderModalStat(
                  "Avg Latency",
                  stat.avgTurnDurationMs != null
                    ? `${(stat.avgTurnDurationMs / 1000).toFixed(1)}s`
                    : "—",
                  false,
                  () => props.onLoadHealthSamples(agent.id),
                )}
              </div>

              ${renderErrorEventsPanel(props, agent.id)}
              ${renderHealthPanel(props, agent.id)}
            `
                : nothing
            }

            <!-- Description -->
            ${
              agent.description
                ? html`
              <div style="margin-bottom: 20px;">
                <div style="${sectionLabelStyle()}">Description</div>
                <div style="font-size: 13px; opacity: 0.7; line-height: 1.6;">${agent.description}</div>
              </div>
            `
                : nothing
            }

            <!-- Model -->
            <div style="margin-bottom: 20px;">
              <div style="${sectionLabelStyle()}">Model</div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="font-size: 13px; font-family: monospace;">
                  <span style="opacity: 0.4; font-size: 11px;">primary: </span>${agent.model?.primary ?? "—"}
                </div>
                ${
                  agent.model?.fallback
                    ? html`
                  <div style="font-size: 12px; font-family: monospace; opacity: 0.5;">
                    <span style="opacity: 0.4; font-size: 11px;">fallback: </span>${agent.model.fallback}
                  </div>
                `
                    : nothing
                }
              </div>
            </div>

            <!-- Last active -->
            ${
              stat?.lastActivityAt
                ? html`
              <div style="margin-bottom: 20px;">
                <div style="${sectionLabelStyle()}">Last Active</div>
                <div style="font-size: 13px; opacity: 0.6;">${stat.lastActivityAt}</div>
              </div>
            `
                : nothing
            }

            <!-- Gateways -->
            ${
              agent.gateways && Object.keys(agent.gateways).length > 0
                ? html`
              <div style="margin-bottom: 20px;">
                <div style="${sectionLabelStyle()}">Gateways</div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  ${Object.entries(agent.gateways).map(
                    ([gw, cfg]) => html`
                    <span style="
                      padding: 3px 10px; border-radius: 10px; font-size: 11px;
                      background: ${(cfg as Record<string, unknown>).enabled !== false ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)"};
                      border: 1px solid ${(cfg as Record<string, unknown>).enabled !== false ? "rgba(34,197,94,0.3)" : "var(--border,#444)"};
                      color: ${(cfg as Record<string, unknown>).enabled !== false ? "#22c55e" : "var(--text-muted,#888)"};
                    ">${gw}</span>
                  `,
                  )}
                </div>
              </div>
            `
                : nothing
            }

            <!-- Skills / Tools -->
            ${renderSkillsInventory(agent)}

            <!-- Delete action (non-orchestrators) -->
            ${
              agent.role !== "orchestrator"
                ? html`
              <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border, #333);">
                <button
                  class="btn btn--sm"
                  style="color: var(--danger, #ef4444); border-color: rgba(239,68,68,0.3);"
                  @click=${() => props.onConfirmDelete(agent.id)}
                >Delete Agent</button>
              </div>
            `
                : nothing
            }
          </div>

          <!-- Right: SOUL.md editor -->
          <div style="padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="${sectionLabelStyle()}">SOUL.md</div>
              <div style="display: flex; gap: 6px;">
                ${
                  props.soulEditing
                    ? html`
                    <button class="btn btn--sm" style="font-size: 11px;" @click=${() => props.onCancelEdit()}>Cancel</button>
                    <button
                      class="btn btn--sm primary"
                      style="font-size: 11px;"
                      ?disabled=${props.soulSaving}
                      @click=${() => props.onSaveSoul(agent.id, props.soulDraft ?? agent.soulContent ?? "")}
                    >${props.soulSaving ? "Saving…" : "Save"}</button>
                  `
                    : html`
                    <button class="btn btn--sm" style="font-size: 11px;" @click=${() => props.onEditSoul()}>Edit</button>
                  `
                }
              </div>
            </div>

            ${props.soulError ? html`<div class="pill danger" style="margin-bottom: 4px; white-space: pre-wrap;">${props.soulError}</div>` : nothing}

            ${
              props.soulEditing
                ? html`
                <textarea
                  style="
                    flex: 1; min-height: 420px; width: 100%; padding: 12px;
                    font-family: monospace; font-size: 12px; line-height: 1.6;
                    background: rgba(0,0,0,0.3); color: var(--text, #e0e0e0);
                    border: 1px solid var(--border, #444); border-radius: 8px;
                    resize: vertical; box-sizing: border-box;
                  "
                  .value=${props.soulDraft ?? agent.soulContent ?? ""}
                  @input=${(e: Event) => props.onSoulDraftChange((e.target as HTMLTextAreaElement).value)}
                ></textarea>
              `
                : html`
                <pre style="
                  flex: 1; min-height: 420px; padding: 12px; margin: 0;
                  font-family: monospace; font-size: 12px; line-height: 1.6;
                  white-space: pre-wrap; word-break: break-word;
                  background: rgba(0,0,0,0.3);
                  border: 1px solid var(--border, #333); border-radius: 8px;
                  overflow-y: auto; color: var(--text, #e0e0e0);
                ">${agent.soulContent ?? "No SOUL.md found for this agent."}</pre>
              `
            }
          <!-- Version history -->
          ${renderSoulVersionHistory(props, agent)}
        </div>
      </div>
    </div>
  `;
}

function renderSoulVersionHistory(props: AgentManagerViewProps, agent: PlatformAgent) {
  const isThisAgent = props.soulVersionsAgentId === agent.id || props.soulVersions !== null;
  const versions = isThisAgent ? (props.soulVersions ?? []) : null;

  return html`
    <div style="border-top: 1px solid var(--border, #333); padding-top: 16px; margin-top: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="${sectionLabelStyle()}">Version History</div>
        <button
          class="btn btn--sm"
          style="font-size: 11px;"
          ?disabled=${props.soulVersionsLoading}
          @click=${() => props.onLoadVersions(agent.id)}
        >${props.soulVersionsLoading ? "Loading…" : versions === null ? "Load Versions" : "Refresh"}</button>
      </div>

      ${
        versions === null
          ? html`
              <div style="font-size: 12px; opacity: 0.4; padding: 8px 0">
                Click "Load Versions" to see available SOUL.md backups.
              </div>
            `
          : versions.length === 0
            ? html`
                <div style="font-size: 12px; opacity: 0.4; padding: 8px 0">
                  No saved versions yet. Versions are created automatically each time you save.
                </div>
              `
            : html`
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${versions.map(
                  (v) => html`
                  <div style="
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 8px 12px; border-radius: 8px;
                    border: 1px solid var(--border, #333);
                    background: rgba(255,255,255,0.02);
                    font-size: 12px;
                  ">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                      <span style="font-family: monospace; opacity: 0.85;">SOUL.v${v.version}.md</span>
                      <span style="font-size: 10px; opacity: 0.45;">${new Date(v.createdAt).toLocaleString()}</span>
                    </div>
                    <button
                      class="btn btn--sm"
                      style="font-size: 10px; padding: 2px 8px;"
                      @click=${() => {
                        if (
                          confirm(
                            `Restore SOUL.v${v.version}.md? The current SOUL.md will be backed up first.`,
                          )
                        ) {
                          props.onRestoreVersion(agent.id, v.version);
                        }
                      }}
                    >Restore</button>
                  </div>
                `,
                )}
              </div>
            `
      }
    </div>
  `;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function renderErrorBreakdown(props: AgentManagerViewProps, agentId: string) {
  if (props.agentErrorsAgentId !== agentId) {
    return nothing;
  }

  if (props.agentErrorsLoading) {
    return html`
      <div
        style="
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid var(--border, #333);
          border-radius: 8px;
          background: rgba(239, 68, 68, 0.04);
          font-size: 12px;
          opacity: 0.6;
        "
      >
        Loading error breakdown…
      </div>
    `;
  }

  const rows = props.agentErrors ?? [];

  if (rows.length === 0) {
    return html`
      <div
        style="
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid var(--border, #333);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.02);
          font-size: 12px;
          opacity: 0.5;
        "
      >
        No error data found in metrics.
      </div>
    `;
  }

  return html`
    <div style="
      margin-bottom: 16px;
      border: 1px solid rgba(239,68,68,0.25);
      border-radius: 8px;
      overflow: hidden;
    ">
      <div style="
        padding: 8px 12px;
        background: rgba(239,68,68,0.08);
        border-bottom: 1px solid rgba(239,68,68,0.15);
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7;
      ">Error History (by day)</div>
      ${rows.map(
        (row) => html`
        <div style="
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 12px; font-size: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
        ">
          <span style="font-family: monospace; opacity: 0.65;">${row.date}</span>
          <span style="
            font-weight: 700; font-variant-numeric: tabular-nums;
            color: var(--danger, #ef4444);
          ">${row.errors} error${row.errors === 1 ? "" : "s"}</span>
        </div>
      `,
      )}
      <div style="padding: 8px 12px; font-size: 11px; opacity: 0.45; line-height: 1.5;">
        These are aggregate counts from daily metrics. For stack traces, check the gateway server logs.
      </div>
    </div>
  `;
}

function renderErrorEventsPanel(props: AgentManagerViewProps, agentId: string) {
  if (props.errorEventsAgentId !== agentId) {
    return nothing;
  }

  if (props.errorEventsLoading) {
    return html`
      <div
        style="
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 8px;
          font-size: 12px;
          opacity: 0.6;
        "
      >
        Loading error details…
      </div>
    `;
  }

  const events = props.errorEvents ?? [];

  if (events.length === 0) {
    return html`
      <div
        style="
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid var(--border, #333);
          border-radius: 8px;
          font-size: 12px;
          opacity: 0.5;
        "
      >
        No error events recorded yet. Errors will appear here when they occur.
      </div>
    `;
  }

  const errorTypeLabel = (type: string) => {
    if (type === "tool_error") {
      return "Tool";
    }
    if (type === "api_error") {
      return "API";
    }
    return "Runtime";
  };

  return html`
    <div style="
      margin-bottom: 16px;
      border: 1px solid rgba(239,68,68,0.25);
      border-radius: 8px;
      overflow: hidden;
    ">
      <div style="
        padding: 8px 12px;
        background: rgba(239,68,68,0.08);
        border-bottom: 1px solid rgba(239,68,68,0.15);
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7;
      ">Recent Errors (${events.length})</div>
      ${events.map(
        (ev) => html`
        <div style="
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          font-size: 12px;
        ">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="
              padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;
              background: rgba(239,68,68,0.15); color: var(--danger, #ef4444);
              text-transform: uppercase; letter-spacing: 0.04em;
            ">${errorTypeLabel(ev.errorType)}</span>
            ${ev.toolName ? html`<span style="font-family: monospace; font-size: 11px; opacity: 0.5;">${ev.toolName}</span>` : nothing}
            <span style="margin-left: auto; font-size: 10px; opacity: 0.4; font-family: monospace;">${ev.createdAt.replace("T", " ").slice(0, 19)}</span>
          </div>
          ${
            ev.errorMessage
              ? html`
            <div style="
              font-size: 12px; opacity: 0.75; line-height: 1.5;
              max-height: 60px; overflow: hidden; text-overflow: ellipsis;
            ">${ev.errorMessage}</div>
          `
              : nothing
          }
          ${
            ev.userId
              ? html`
            <div style="font-size: 10px; opacity: 0.35; margin-top: 3px;">User: ${ev.userId}</div>
          `
              : nothing
          }
        </div>
      `,
      )}
    </div>
  `;
}

function renderHealthPanel(props: AgentManagerViewProps, agentId: string) {
  if (props.healthSamplesAgentId !== agentId) {
    return nothing;
  }

  if (props.healthSamplesLoading) {
    return html`
      <div
        style="
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 8px;
          font-size: 12px;
          opacity: 0.6;
        "
      >
        Loading latency data…
      </div>
    `;
  }

  const samples = props.healthSamples ?? [];

  if (samples.length === 0) {
    return html`
      <div
        style="
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid var(--border, #333);
          border-radius: 8px;
          font-size: 12px;
          opacity: 0.5;
        "
      >
        No latency data yet. Samples are recorded after each completed turn.
      </div>
    `;
  }

  const statusColor = (s: string) =>
    s === "success" ? "#22c55e" : s === "error" ? "#ef4444" : "#f59e0b";

  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`);

  const avg = Math.round(samples.reduce((sum, s) => sum + s.turnDurationMs, 0) / samples.length);
  const p95 = (() => {
    const sorted = [...samples].toSorted((a, b) => a.turnDurationMs - b.turnDurationMs);
    const idx = Math.floor(sorted.length * 0.95);
    return sorted[idx]?.turnDurationMs ?? sorted[sorted.length - 1]?.turnDurationMs ?? 0;
  })();

  return html`
    <div style="
      margin-bottom: 16px;
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 8px;
      overflow: hidden;
    ">
      <div style="
        padding: 8px 12px;
        background: rgba(99,102,241,0.08);
        border-bottom: 1px solid rgba(99,102,241,0.15);
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7;
        display: flex; gap: 16px; align-items: center;
      ">
        <span>Latency — Last ${samples.length} Turns</span>
        <span style="font-weight: 400; opacity: 0.6;">avg ${fmtMs(avg)} · p95 ${fmtMs(p95)}</span>
      </div>
      ${samples.slice(0, 20).map(
        (s) => html`
        <div style="
          padding: 8px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          font-size: 12px;
          display: flex; align-items: center; gap: 10px;
        ">
          <span style="
            width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
            background: ${statusColor(s.status)};
          "></span>
          <span style="font-weight: 600; font-variant-numeric: tabular-nums; min-width: 52px;">${fmtMs(s.turnDurationMs)}</span>
          ${s.model ? html`<span style="font-size: 10px; opacity: 0.4; font-family: monospace;">${s.model.split("/").pop()}</span>` : nothing}
          <span style="margin-left: auto; font-size: 10px; opacity: 0.4; font-family: monospace;">${s.createdAt.replace("T", " ").slice(0, 19)}</span>
        </div>
      `,
      )}
    </div>
  `;
}

function renderModalStat(label: string, value: string, danger = false, onClick?: () => void) {
  const clickable = onClick != null;
  return html`
    <div
      style="
        padding: 12px 14px;
        border: 1px solid var(--border, #333);
        border-radius: 8px;
        background: rgba(255,255,255,0.02);
        ${clickable ? "cursor: pointer; transition: border-color 0.15s;" : ""}
      "
      @click=${onClick ?? nothing}
      title=${clickable ? `View ${label.toLowerCase()} breakdown` : ""}
    >
      <div style="
        font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums;
        color: ${danger ? "var(--danger, #ef4444)" : "var(--accent, #00A3E1)"};
      ">${value}</div>
      <div style="font-size: 11px; opacity: 0.45; margin-top: 2px;">
        ${label}${
          clickable
            ? html`
                <span style="margin-left: 4px; opacity: 0.6">↗</span>
              `
            : ""
        }
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Skills inventory
// ---------------------------------------------------------------------------

const INTER_AGENT_TOOL_NAMES = new Set(["ask_agent", "delegate_to_agent", "notify_agent"]);

function renderSkillsInventory(agent: PlatformAgent) {
  const cortex = agent.skills?.cortex as Record<string, unknown> | undefined;
  if (!cortex) {
    return nothing;
  }

  const mcps = (cortex.mcps as string[] | undefined) ?? [];
  const allToolsAllow =
    ((cortex.tools as Record<string, unknown>)?.allow as string[] | undefined) ?? [];

  const interAgentTools = allToolsAllow.filter((t) => INTER_AGENT_TOOL_NAMES.has(t));
  const cortexTools = allToolsAllow.filter((t) => !INTER_AGENT_TOOL_NAMES.has(t));

  if (mcps.length === 0 && allToolsAllow.length === 0) {
    return nothing;
  }

  return html`
    <div style="margin-bottom: 20px;">
      <div style="${sectionLabelStyle()}">Skills &amp; Tools</div>

      ${
        mcps.length > 0
          ? html`
        <div style="margin-bottom: 10px;">
          <div style="font-size: 11px; opacity: 0.4; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em;">MCPs</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${mcps.map(
              (mcp) => html`
              <span style="
                padding: 3px 10px; border-radius: 10px; font-size: 11px; font-family: monospace;
                background: rgba(0, 163, 225, 0.08);
                border: 1px solid rgba(0, 163, 225, 0.25);
                color: var(--accent, #00A3E1);
              ">${mcp}</span>
            `,
            )}
          </div>
        </div>
      `
          : nothing
      }

      ${
        interAgentTools.length > 0
          ? html`
        <div style="margin-bottom: 10px;">
          <div style="font-size: 11px; opacity: 0.4; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em;">
            Agent Communication
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${interAgentTools.map(
              (tool) => html`
              <span style="
                padding: 2px 8px; border-radius: 6px; font-size: 10px; font-family: monospace;
                background: rgba(168, 85, 247, 0.08);
                border: 1px solid rgba(168, 85, 247, 0.3);
                color: rgba(168, 85, 247, 0.9);
              ">${tool}</span>
            `,
            )}
          </div>
        </div>
      `
          : nothing
      }

      ${
        cortexTools.length > 0
          ? html`
        <div>
          <div style="font-size: 11px; opacity: 0.4; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em;">
            Allowed Tools (${cortexTools.length})
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 120px; overflow-y: auto;">
            ${cortexTools.map(
              (tool) => html`
              <span style="
                padding: 2px 8px; border-radius: 6px; font-size: 10px; font-family: monospace;
                background: rgba(255,255,255,0.04);
                border: 1px solid var(--border, #333);
                opacity: 0.75;
              ">${tool}</span>
            `,
            )}
          </div>
        </div>
      `
          : nothing
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Usage section
// ---------------------------------------------------------------------------

function renderUsageSection(props: AgentManagerViewProps) {
  const metrics = props.metrics;
  if (!metrics?.length) {
    return nothing;
  }

  const recent = metrics.slice(0, 14);

  return html`
    <div style="margin-bottom: 32px;">
      <div style="${sectionLabelStyle()} margin-bottom: 12px;">Usage — Last 7 Days</div>
      <div style="overflow-x: auto; border: 1px solid var(--border, #333); border-radius: 10px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border, #333); background: rgba(255,255,255,0.02);">
              <th style="text-align: left; padding: 8px 14px; opacity: 0.5; font-weight: 600;">Date</th>
              <th style="text-align: left; padding: 8px 14px; opacity: 0.5; font-weight: 600;">Agent</th>
              <th style="text-align: right; padding: 8px 14px; opacity: 0.5; font-weight: 600;">Convos</th>
              <th style="text-align: right; padding: 8px 14px; opacity: 0.5; font-weight: 600;">Messages</th>
              <th style="text-align: right; padding: 8px 14px; opacity: 0.5; font-weight: 600;">Tools</th>
              <th style="text-align: right; padding: 8px 14px; opacity: 0.5; font-weight: 600;">Tokens</th>
              <th style="text-align: right; padding: 8px 14px; opacity: 0.5; font-weight: 600;">Errors</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(
              (m) => html`
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                  <td style="padding: 7px 14px; font-family: monospace;">${m.date}</td>
                  <td style="padding: 7px 14px; opacity: 0.8;">${m.agentId}</td>
                  <td style="padding: 7px 14px; text-align: right;">${m.conversations}</td>
                  <td style="padding: 7px 14px; text-align: right;">${m.messages}</td>
                  <td style="padding: 7px 14px; text-align: right;">${m.toolCalls}</td>
                  <td style="padding: 7px 14px; text-align: right;">${fmt(m.tokensInput + m.tokensOutput)}</td>
                  <td style="padding: 7px 14px; text-align: right; ${m.errors > 0 ? "color: var(--danger, #ef4444);" : ""}">${m.errors || "—"}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------

function renderCreateModal(props: AgentManagerViewProps) {
  return html`
    <div
      style="position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:600;backdrop-filter:blur(4px);"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          props.onShowCreateModal(false);
        }
      }}
    >
      <div style="
        background: rgba(24, 28, 35, 0.97);
        border: 1px solid var(--border, #444);
        border-radius: 14px; padding: 28px;
        min-width: 420px; max-width: 500px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.5);
        backdrop-filter: blur(20px);
      ">
        <div style="font-size: 18px; font-weight: 700; margin-bottom: 20px;">Create New Agent</div>
        ${props.createError ? html`<div class="pill danger" style="margin-bottom: 12px;">${props.createError}</div>` : nothing}

        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; opacity: 0.6; margin-bottom: 4px;">Agent Name</label>
          <input id="create-agent-name" type="text" placeholder="e.g. Analyst, Researcher"
            style="width: 100%; padding: 8px 12px; font-size: 14px; box-sizing: border-box; background: rgba(0,0,0,0.4); color: var(--text, #e0e0e0); border: 1px solid var(--border, #444); border-radius: 8px;"
          />
        </div>
        <div style="margin-bottom: 24px;">
          <label style="display: block; font-size: 12px; opacity: 0.6; margin-bottom: 4px;">Model</label>
          <input id="create-agent-model" type="text" value="anthropic/claude-sonnet-4-5-20250929"
            style="width: 100%; padding: 8px 12px; font-size: 13px; box-sizing: border-box; font-family: monospace; background: rgba(0,0,0,0.4); color: var(--text, #e0e0e0); border: 1px solid var(--border, #444); border-radius: 8px;"
          />
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button class="btn btn--sm" @click=${() => props.onShowCreateModal(false)}>Cancel</button>
          <button class="btn btn--sm primary" @click=${() => {
            const name = (
              document.getElementById("create-agent-name") as HTMLInputElement
            )?.value?.trim();
            const model = (
              document.getElementById("create-agent-model") as HTMLInputElement
            )?.value?.trim();
            if (name) {
              props.onCreateAgent({ name, model: model || undefined });
            }
          }}>Create Agent</button>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

function renderDeleteDialog(props: AgentManagerViewProps) {
  const agentId = props.deleteConfirmId;
  const agent = props.agents?.find((a) => a.id === agentId);

  return html`
    <div
      style="position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:700;backdrop-filter:blur(4px);"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          props.onConfirmDelete(null);
        }
      }}
    >
      <div style="
        background: rgba(24, 28, 35, 0.97);
        border: 1px solid var(--border, #444);
        border-radius: 14px; padding: 28px;
        min-width: 380px; max-width: 440px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.5);
        backdrop-filter: blur(20px);
      ">
        <div style="font-size: 18px; font-weight: 700; margin-bottom: 12px;">Delete Agent</div>
        <div style="font-size: 14px; opacity: 0.7; margin-bottom: 24px; line-height: 1.5;">
          Are you sure you want to delete <strong>${agent?.displayName ?? agentId}</strong>?
          This will permanently remove the agent configuration and workspace.
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button class="btn btn--sm" @click=${() => props.onConfirmDelete(null)}>Cancel</button>
          <button
            class="btn btn--sm"
            style="background: var(--danger, #ef4444); color: #fff; border-color: transparent;"
            @click=${() => {
              if (agentId) {
                props.onDeleteAgent(agentId);
              }
            }}
          >Delete</button>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionLabelStyle() {
  return "font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; opacity: 0.4; margin-bottom: 8px;";
}

function fmt(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

function shortModel(model: string): string {
  return model.replace(/^anthropic\//, "").replace(/-\d{8}$/, "");
}
