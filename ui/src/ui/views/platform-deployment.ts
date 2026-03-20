/**
 * Platform Deployment View
 *
 * Topology map of all agents with per-agent health metrics, gateway links,
 * MCP connections, and inter-agent ACLs. Phase 5 of the Athena admin portal.
 */
import { html, nothing } from "lit";
import type { MCPConnection } from "../controllers/agents.ts";
import type { PlatformAgent, AgentStatsEntry } from "../controllers/platform.ts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PlatformDeploymentViewProps = {
  loading: boolean;
  error: string | null;
  agents: PlatformAgent[] | null;
  agentStats: AgentStatsEntry[] | null;
  connections: MCPConnection[] | null;
  restartLoading: boolean;
  restartResult: { ok: boolean; message: string } | null;
  agentResetLoading: string | null; // agentId currently being reset, or null
  agentResetResult: { agentId: string; ok: boolean; message: string } | null;
  onRefresh: () => void;
  onRestart: () => void;
  onResetAgent: (agentId: string) => void;
  onNavigateToAgent: (agentId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statsForAgent(agentId: string, stats: AgentStatsEntry[] | null): AgentStatsEntry | null {
  return stats?.find((s) => s.agentId === agentId) ?? null;
}

function isAgentActive(stats: AgentStatsEntry | null): boolean {
  if (!stats?.lastActivityAt) {
    return false;
  }
  const last = new Date(stats.lastActivityAt).getTime();
  const hourAgo = Date.now() - 60 * 60 * 1000;
  return last > hourAgo;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "Never";
  }
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) {
    return "Just now";
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}m ago`;
  }
  if (delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)}h ago`;
  }
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
}

function agentStatusColor(active: boolean): string {
  if (active) {
    return "var(--green, #22c55e)";
  }
  return "var(--text-muted, #6b7280)";
}

function agentStatusLabel(active: boolean): string {
  if (active) {
    return "Active";
  }
  return "Idle";
}

function getEnabledGateways(agent: PlatformAgent): string[] {
  return Object.entries(agent.gateways)
    .filter(([, cfg]) => cfg?.enabled !== false)
    .map(([name]) => name);
}

function getConnectedMCPs(agent: PlatformAgent, connections: MCPConnection[] | null): string[] {
  const cortex = agent.skills?.cortex as Record<string, unknown> | undefined;
  const allowed = cortex?.allowMcps as string[] | undefined;
  if (!allowed?.length) {
    return [];
  }
  const connected = new Set(
    (connections ?? []).filter((c) => c.status === "active").map((c) => c.mcp_name),
  );
  return allowed.filter((m) => connected.has(m));
}

function getAllowedAgents(agent: PlatformAgent, allAgents: PlatformAgent[]): PlatformAgent[] {
  const allowed = agent.subagents?.allowAgents ?? [];
  return allAgents.filter((a) => allowed.includes(a.id));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function renderAgentCard(
  agent: PlatformAgent,
  stats: AgentStatsEntry | null,
  connections: MCPConnection[] | null,
  allAgents: PlatformAgent[],
  onNavigate: (id: string) => void,
  onReset: (id: string) => void,
  resetLoading: boolean,
  resetResult: { ok: boolean; message: string } | null,
) {
  const active = isAgentActive(stats);
  const errors = stats?.errors ?? 0;
  const statusColor = agentStatusColor(active);
  const statusLabel = agentStatusLabel(active);
  const gateways = getEnabledGateways(agent);
  const mcps = getConnectedMCPs(agent, connections);
  const subagents = getAllowedAgents(agent, allAgents);

  return html`
    <div class="deploy-card" style="
      background: var(--glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      position: relative;
      transition: border-color 0.2s;
    ">
      <!-- Status indicator strip -->
      <div style="
        position: absolute;
        top: 0; left: 0;
        width: 4px; height: 100%;
        border-radius: 12px 0 0 12px;
        background: ${statusColor};
      "></div>

      <!-- Header -->
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-left: 8px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 15px; font-weight: 600; color: var(--text-primary, #f1f5f9);">
              ${agent.displayName}
            </span>
            <span style="
              font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
              padding: 2px 7px; border-radius: 4px;
              background: ${statusColor}22; color: ${statusColor};
            ">${statusLabel}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-muted, #6b7280); margin-top: 3px;">
            ${agent.id} · ${agent.role}
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0;">
          <button
            @click=${() => {
              if (
                confirm(
                  `Reset agent session for "${agent.displayName}"?\n\nThis unregisters the agent from the message bus. It will re-register on next startup.`,
                )
              ) {
                onReset(agent.id);
              }
            }}
            ?disabled=${resetLoading}
            style="
              background: rgba(239,68,68,0.08);
              border: 1px solid rgba(239,68,68,0.2);
              color: #ef4444;
              border-radius: 6px;
              padding: 4px 10px;
              font-size: 11px;
              cursor: pointer;
              white-space: nowrap;
            "
            title="Unregister this agent from the message bus (soft reset)"
          >${resetLoading ? "Resetting…" : "Reset"}</button>
          <button
            @click=${() => onNavigate(agent.id)}
            style="
              background: transparent;
              border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
              color: var(--text-muted, #6b7280);
              border-radius: 6px;
              padding: 4px 10px;
              font-size: 11px;
              cursor: pointer;
              white-space: nowrap;
            "
          >View agent</button>
        </div>
        ${
          resetResult
            ? html`
          <div style="
            font-size: 11px;
            color: ${resetResult.ok ? "var(--green, #22c55e)" : "var(--red, #ef4444)"};
            margin-top: 4px;
          ">${resetResult.message}</div>
        `
            : nothing
        }
      </div>

      <!-- Stats row -->
      <div style="
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        padding-left: 8px;
      ">
        ${renderMetricCell("Convos", formatNumber(stats?.conversations ?? 0))}
        ${renderMetricCell("Messages", formatNumber(stats?.messages ?? 0))}
        ${renderMetricCell("Tokens", formatNumber((stats?.tokensInput ?? 0) + (stats?.tokensOutput ?? 0)))}
        ${renderMetricCell("Last active", formatRelativeTime(stats?.lastActivityAt ?? null))}
      </div>

      <!-- Model -->
      <div style="padding-left: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span style="font-size: 11px; color: var(--text-muted, #6b7280);">Model:</span>
        <span style="
          font-size: 11px; font-family: monospace;
          color: var(--accent, #6366f1);
          background: var(--accent, #6366f1)15;
          padding: 2px 8px; border-radius: 4px;
        ">${agent.model.primary}</span>
        ${
          agent.model.fallback
            ? html`
          <span style="font-size: 11px; color: var(--text-muted, #6b7280);">↳ fallback: <span style="font-family: monospace;">${agent.model.fallback}</span></span>
        `
            : nothing
        }
      </div>

      <!-- Gateways -->
      ${
        gateways.length > 0
          ? html`
        <div style="padding-left: 8px;">
          <div style="font-size: 11px; color: var(--text-muted, #6b7280); margin-bottom: 6px;">Gateways</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${gateways.map(
              (gw) => html`<span style="
                font-size: 11px; padding: 2px 8px; border-radius: 4px;
                background: rgba(99,102,241,0.12); color: var(--accent, #6366f1);
                border: 1px solid rgba(99,102,241,0.2);
              ">${gw}</span>`,
            )}
          </div>
        </div>
      `
          : nothing
      }

      <!-- MCP connections -->
      ${
        mcps.length > 0
          ? html`
        <div style="padding-left: 8px;">
          <div style="font-size: 11px; color: var(--text-muted, #6b7280); margin-bottom: 6px;">Connected MCPs</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${mcps.map(
              (m) => html`<span style="
                font-size: 11px; padding: 2px 8px; border-radius: 4px;
                background: rgba(34,197,94,0.1); color: var(--green, #22c55e);
                border: 1px solid rgba(34,197,94,0.2);
              ">${m}</span>`,
            )}
          </div>
        </div>
      `
          : nothing
      }

      <!-- Sub-agents ACL -->
      ${
        subagents.length > 0
          ? html`
        <div style="padding-left: 8px;">
          <div style="font-size: 11px; color: var(--text-muted, #6b7280); margin-bottom: 6px;">Can delegate to</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${subagents.map(
              (sa) => html`<span style="
                font-size: 11px; padding: 2px 8px; border-radius: 4px;
                background: rgba(168,85,247,0.1); color: var(--purple, #a855f7);
                border: 1px solid rgba(168,85,247,0.2);
              ">${sa.displayName}</span>`,
            )}
          </div>
        </div>
      `
          : nothing
      }

      <!-- Errors warning -->
      ${
        errors > 0
          ? html`
        <div style="
          padding-left: 8px;
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; color: var(--yellow, #eab308);
        ">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          ${errors} error${errors === 1 ? "" : "s"} (all time)
        </div>
      `
          : nothing
      }
    </div>
  `;
}

function renderMetricCell(label: string, value: string) {
  return html`
    <div style="
      background: var(--glass-bg, rgba(255,255,255,0.02));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.06));
      border-radius: 8px;
      padding: 8px 10px;
      text-align: center;
    ">
      <div style="font-size: 13px; font-weight: 600; color: var(--text-primary, #f1f5f9);">${value}</div>
      <div style="font-size: 10px; color: var(--text-muted, #6b7280); margin-top: 2px;">${label}</div>
    </div>
  `;
}

function renderSummaryBar(
  agents: PlatformAgent[],
  agentStats: AgentStatsEntry[] | null,
  connections: MCPConnection[] | null,
) {
  const activeCount = agents.filter((a) => isAgentActive(statsForAgent(a.id, agentStats))).length;
  const totalErrors = agents.reduce(
    (sum, a) => sum + (statsForAgent(a.id, agentStats)?.errors ?? 0),
    0,
  );
  const connectedMcpCount = new Set(
    (connections ?? []).filter((c) => c.status === "active").map((c) => c.mcp_name),
  ).size;
  const orchestrators = agents.filter((a) => a.role === "orchestrator").length;
  const specialists = agents.filter((a) => a.role === "specialist").length;

  return html`
    <div style="
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    ">
      ${renderSummaryCell("Total Agents", String(agents.length), "var(--text-primary, #f1f5f9)")}
      ${renderSummaryCell("Active Now", String(activeCount), "var(--green, #22c55e)")}
      ${renderSummaryCell("Total Errors", String(totalErrors), totalErrors > 0 ? "var(--yellow, #eab308)" : "var(--text-muted, #6b7280)")}
      ${renderSummaryCell("Orchestrators / Specialists", `${orchestrators} / ${specialists}`, "var(--accent, #6366f1)")}
      ${renderSummaryCell("Connected MCPs", String(connectedMcpCount), "var(--green, #22c55e)")}
    </div>
  `;
}

function renderSummaryCell(label: string, value: string, color: string) {
  return html`
    <div style="
      background: var(--glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
      border-radius: 10px;
      padding: 14px 16px;
      text-align: center;
    ">
      <div style="font-size: 20px; font-weight: 700; color: ${color};">${value}</div>
      <div style="font-size: 11px; color: var(--text-muted, #6b7280); margin-top: 4px;">${label}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function renderPlatformDeployment(props: PlatformDeploymentViewProps) {
  if (props.loading && !props.agents) {
    return html`
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 80px 0;
          color: var(--text-muted, #6b7280);
        "
      >
        Loading topology…
      </div>
    `;
  }

  if (props.error) {
    return html`
      <div style="padding: 24px;">
        <div style="
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 8px;
          padding: 14px 18px;
          color: #ef4444;
          font-size: 13px;
        ">Failed to load deployment topology: ${props.error}</div>
      </div>
    `;
  }

  const agents = props.agents ?? [];
  const orchestrators = agents.filter((a) => a.role === "orchestrator");
  const specialists = agents.filter((a) => a.role === "specialist");

  return html`
    <div style="padding: 0 0 40px;">
      <!-- Page header -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
        <div>
          <h1 class="page-title" style="margin: 0 0 4px;">Deployment</h1>
          <p class="page-sub" style="margin: 0;">Live topology of agents, gateways, and integrations</p>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${
            props.restartResult
              ? html`
            <span style="
              font-size: 12px;
              color: ${props.restartResult.ok ? "var(--green, #22c55e)" : "var(--red, #ef4444)"};
              max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            ">${props.restartResult.message}</span>
          `
              : nothing
          }
          <button
            class="btn btn--sm btn--danger"
            style="background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.25); color: #ef4444;"
            @click=${() => {
              if (
                confirm(
                  "Restart the Athena gateway container?\n\nThis will briefly interrupt all active conversations.",
                )
              ) {
                props.onRestart();
              }
            }}
            ?disabled=${props.restartLoading}
          >${props.restartLoading ? "Restarting…" : "Restart Gateway"}</button>
          <button
            class="btn btn--sm"
            @click=${props.onRefresh}
            ?disabled=${props.loading}
          >${props.loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      <!-- Summary bar -->
      ${renderSummaryBar(agents, props.agentStats, props.connections)}

      <!-- Orchestrators -->
      ${
        orchestrators.length > 0
          ? html`
        <div style="margin-bottom: 32px;">
          <div style="
            font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
            color: var(--text-muted, #6b7280); margin-bottom: 12px;
          ">Orchestrators</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px;">
            ${orchestrators.map((a) =>
              renderAgentCard(
                a,
                statsForAgent(a.id, props.agentStats),
                props.connections,
                agents,
                props.onNavigateToAgent,
                props.onResetAgent,
                props.agentResetLoading === a.id,
                props.agentResetResult?.agentId === a.id ? props.agentResetResult : null,
              ),
            )}
          </div>
        </div>
      `
          : nothing
      }

      <!-- Specialists -->
      ${
        specialists.length > 0
          ? html`
        <div>
          <div style="
            font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
            color: var(--text-muted, #6b7280); margin-bottom: 12px;
          ">Specialists</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px;">
            ${specialists.map((a) =>
              renderAgentCard(
                a,
                statsForAgent(a.id, props.agentStats),
                props.connections,
                agents,
                props.onNavigateToAgent,
                props.onResetAgent,
                props.agentResetLoading === a.id,
                props.agentResetResult?.agentId === a.id ? props.agentResetResult : null,
              ),
            )}
          </div>
        </div>
      `
          : nothing
      }

      ${
        agents.length === 0
          ? html`
              <div
                style="text-align: center; padding: 60px 0; color: var(--text-muted, #6b7280); font-size: 14px"
              >
                No agents found. Check that the gateway is connected.
              </div>
            `
          : nothing
      }
    </div>
  `;
}
