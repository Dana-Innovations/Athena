/**
 * Platform Dashboard View
 *
 * Shows platform-wide stats (agent count, conversations, messages, memory),
 * per-agent health cards, and quick actions.
 */
import { html, nothing } from "lit";
import type { AgentStatsEntry, PlatformMetric, PlatformStats } from "../controllers/platform.ts";

export type PlatformDashboardViewProps = {
  loading: boolean;
  error: string | null;
  stats: PlatformStats | null;
  agentStats: AgentStatsEntry[] | null;
  metrics: PlatformMetric[] | null;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
};

export function renderPlatformDashboard(props: PlatformDashboardViewProps) {
  return html`
    <div class="page-title">Athena Platform</div>
    <div class="page-sub">Agent health, conversations, and usage at a glance.</div>

    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
      >${props.loading ? "Loading..." : "Refresh"}</button>
    </div>

    ${props.error ? html`<div class="pill danger" style="margin-bottom: 16px;">${props.error}</div>` : nothing}

    ${props.stats ? renderStatCards(props.stats, props.onNavigate) : nothing}
    ${props.agentStats?.length ? renderAgentCards(props.agentStats) : nothing}
    ${props.metrics?.length ? renderRecentMetrics(props.metrics) : nothing}
  `;
}

function renderStatCards(stats: PlatformStats, onNavigate: (tab: string) => void) {
  const cards = [
    { label: "Agents", value: stats.agents, icon: "🤖", tab: "agents" },
    {
      label: "Conversations",
      value: stats.conversations,
      icon: "💬",
      tab: "platform-conversations",
    },
    { label: "Messages", value: stats.messages, icon: "📨", tab: "" },
    { label: "Memory Entries", value: stats.memoryEntries, icon: "🧠", tab: "platform-memory" },
    { label: "Active Today", value: stats.activeUsersToday, icon: "👤", tab: "" },
    {
      label: "Errors Today",
      value: stats.errorsToday,
      icon: stats.errorsToday > 0 ? "⚠️" : "✅",
      tab: "platform-audit",
    },
  ];

  return html`
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px;">
      ${cards.map(
        (c) => html`
          <div
            class="card"
            style="padding: 16px; cursor: ${c.tab ? "pointer" : "default"}; border: 1px solid var(--border, #333); border-radius: 8px; background: var(--bg-secondary, #1a1a2e);"
            @click=${() => c.tab && onNavigate(c.tab)}
          >
            <div style="font-size: 24px; margin-bottom: 4px;">${c.icon}</div>
            <div style="font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums;">${formatNumber(c.value)}</div>
            <div style="font-size: 12px; opacity: 0.6; margin-top: 2px;">${c.label}</div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderAgentCards(agents: AgentStatsEntry[]) {
  return html`
    <div style="margin-bottom: 24px;">
      <h3 style="margin: 0 0 12px; font-size: 16px; font-weight: 600;">Agent Health</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
        ${agents.map(
          (a) => html`
            <div style="padding: 16px; border: 1px solid var(--border, #333); border-radius: 8px; background: var(--bg-secondary, #1a1a2e);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 600; font-size: 14px;">${a.agentId}</span>
                <span class="pill ${a.errors > 0 ? "danger" : "success"}" style="font-size: 11px;">
                  ${a.errors > 0 ? `${a.errors} errors` : "healthy"}
                </span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 12px;">
                <div><span style="opacity: 0.5;">Conversations:</span> ${formatNumber(a.conversations)}</div>
                <div><span style="opacity: 0.5;">Messages:</span> ${formatNumber(a.messages)}</div>
                <div><span style="opacity: 0.5;">Users:</span> ${a.uniqueUsers}</div>
                <div><span style="opacity: 0.5;">Tokens:</span> ${formatNumber(a.tokensInput + a.tokensOutput)}</div>
              </div>
              ${a.lastActivityAt ? html`<div style="font-size: 11px; opacity: 0.4; margin-top: 6px;">Last active: ${a.lastActivityAt}</div>` : nothing}
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

function renderRecentMetrics(metrics: PlatformMetric[]) {
  const recent = metrics.slice(0, 7);
  if (recent.length === 0) {
    return nothing;
  }

  return html`
    <div style="margin-bottom: 24px;">
      <h3 style="margin: 0 0 12px; font-size: 16px; font-weight: 600;">Recent Usage (Last 7 Days)</h3>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border, #333);">
              <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Date</th>
              <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Agent</th>
              <th style="text-align: right; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Convos</th>
              <th style="text-align: right; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Messages</th>
              <th style="text-align: right; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Tools</th>
              <th style="text-align: right; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Tokens</th>
              <th style="text-align: right; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Errors</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(
              (m) => html`
                <tr style="border-bottom: 1px solid var(--border, #222);">
                  <td style="padding: 8px 12px;" class="mono">${m.date}</td>
                  <td style="padding: 8px 12px;">${m.agentId}</td>
                  <td style="padding: 8px 12px; text-align: right;">${m.conversations}</td>
                  <td style="padding: 8px 12px; text-align: right;">${m.messages}</td>
                  <td style="padding: 8px 12px; text-align: right;">${m.toolCalls}</td>
                  <td style="padding: 8px 12px; text-align: right;">${formatNumber(m.tokensInput + m.tokensOutput)}</td>
                  <td style="padding: 8px 12px; text-align: right; ${m.errors > 0 ? "color: var(--danger, #ef4444);" : ""}">${m.errors}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}
