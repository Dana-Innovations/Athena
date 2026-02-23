/**
 * Apollo Usage View
 *
 * Tabbed dashboard for Cortex Apollo proxy usage:
 *   - Users: per-user cost leaderboard with org totals
 *   - Recent Requests: individual AI request log
 *   - Models: usage aggregated by AI model
 */

import { html, nothing } from "lit";
import type {
  ApolloStatusResult,
  ApolloUsageResult,
  ApolloUserBreakdownEntry,
  ApolloUserSortField,
} from "../controllers/apollo.ts";

export type ApolloTab = "users" | "requests" | "models";

export type ApolloViewProps = {
  loading: boolean;
  error: string | null;
  status: ApolloStatusResult | null;
  usage: ApolloUsageResult | null;
  activeTab: ApolloTab;
  userFilter: string;
  userSort: ApolloUserSortField;
  userSortDir: "asc" | "desc";
  onRefresh: () => void;
  onTabChange: (tab: ApolloTab) => void;
  onUserFilterChange: (email: string) => void;
  onUserSortChange: (field: ApolloUserSortField) => void;
};

// ── Formatters ──────────────────────────────────────────────────────────

const fmt = (n: number) => (n ?? 0).toLocaleString();
const fmtCost = (n: number) => {
  const v = n ?? 0;
  return v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function shortModel(model: string): string {
  return model.replace(/^anthropic\//, "").replace(/-\d{8}$/, "");
}

// ── Connection banner ───────────────────────────────────────────────────

function renderConnectionBanner(status: ApolloStatusResult | null) {
  if (!status) {
    return nothing;
  }
  const healthy = status.apolloHealthy;
  const source = status.keyStatus?.activeSource ?? "unknown";
  const sourceLabel: Record<string, string> = {
    org: "Organization Key",
    user_key: "User API Key",
    user_oauth: "OAuth Token",
    none: "No Key",
  };

  return html`
    <div style="
      display: flex; align-items: center; gap: 16px; padding: 10px 16px;
      background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb);
      border-radius: 10px; margin-bottom: 20px; flex-wrap: wrap;
    ">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="
          width: 8px; height: 8px; border-radius: 50%;
          background: ${healthy ? "#22c55e" : "#ef4444"};
          box-shadow: 0 0 6px ${healthy ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"};
        "></span>
        <span style="font-weight: 500; font-size: 0.875rem;">
          ${healthy ? "Connected" : "Unreachable"}
        </span>
      </div>
      <span style="color: var(--text-muted, #9ca3af); font-size: 0.8rem;">
        ${status.apolloBaseUrl ?? "—"}
      </span>
      <span class="pill pill--sm" style="font-size: 0.75rem;">
        ${sourceLabel[source] ?? source}
      </span>
    </div>
  `;
}

// ── Summary hero cards ──────────────────────────────────────────────────

function renderHeroStats(usage: ApolloUsageResult | null) {
  if (!usage) {
    return nothing;
  }

  const hasOrg = !!usage.dashboardTotals;
  const totals = usage.dashboardTotals ?? usage;

  const cards = [
    { value: fmt(totals.totalRequests), label: "Requests" },
    { value: fmt(totals.totalInputTokens + totals.totalOutputTokens), label: "Tokens" },
    { value: fmtCost(totals.totalCost), label: "Total Cost" },
  ];

  return html`
    <div style="
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
      margin-bottom: 24px;
    ">
      ${cards.map(
        (c) => html`
          <div style="
            background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb);
            border-radius: 12px; padding: 20px 16px; text-align: center;
          ">
            <div style="font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2;">
              ${c.value}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted, #9ca3af); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em;">
              ${c.label}${hasOrg ? " (Org)" : ""}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

// ── Tab bar ─────────────────────────────────────────────────────────────

const TAB_ITEMS: { id: ApolloTab; label: string }[] = [
  { id: "users", label: "By User" },
  { id: "requests", label: "Recent Requests" },
  { id: "models", label: "By Model" },
];

function renderTabBar(
  active: ApolloTab,
  onChange: (tab: ApolloTab) => void,
  loading: boolean,
  onRefresh: () => void,
) {
  return html`
    <div style="
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--border, #e5e7eb);
      margin-bottom: 20px; gap: 8px; flex-wrap: wrap;
    ">
      <div style="display: flex; gap: 0;">
        ${TAB_ITEMS.map(
          (tab) => html`
            <button
              style="
                padding: 10px 20px; font-size: 0.875rem; font-weight: 500;
                border: none; background: none; cursor: pointer;
                color: ${active === tab.id ? "var(--accent, #6366f1)" : "var(--text-muted, #9ca3af)"};
                border-bottom: 2px solid ${active === tab.id ? "var(--accent, #6366f1)" : "transparent"};
                transition: all 0.15s ease;
                margin-bottom: -1px;
              "
              @click=${() => onChange(tab.id)}
            >
              ${tab.label}
            </button>
          `,
        )}
      </div>
      <button
        class="btn btn--sm"
        style="margin-bottom: 4px;"
        ?disabled=${loading}
        @click=${() => onRefresh()}
      >
        ${loading ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  `;
}

// ── Tab: Users ──────────────────────────────────────────────────────────

function sortUserBreakdown(
  users: ApolloUserBreakdownEntry[],
  field: ApolloUserSortField,
  dir: "asc" | "desc",
): ApolloUserBreakdownEntry[] {
  return [...users].toSorted((a, b) => {
    let va: number;
    let vb: number;
    switch (field) {
      case "cost":
        va = a.cost ?? 0;
        vb = b.cost ?? 0;
        break;
      case "requests":
        va = a.requests ?? 0;
        vb = b.requests ?? 0;
        break;
      case "tokens":
        va = a.totalTokens ?? 0;
        vb = b.totalTokens ?? 0;
        break;
      case "costPerRequest":
        va = (a.requests ?? 0) > 0 ? (a.cost ?? 0) / a.requests : 0;
        vb = (b.requests ?? 0) > 0 ? (b.cost ?? 0) / b.requests : 0;
        break;
    }
    return dir === "desc" ? vb - va : va - vb;
  });
}

function renderUsersTab(
  usage: ApolloUsageResult | null,
  sort: ApolloUserSortField,
  sortDir: "asc" | "desc",
  userFilter: string,
  onSortChange: (field: ApolloUserSortField) => void,
  onUserFilterChange: (email: string) => void,
) {
  const users =
    usage?.dashboardUsers && usage.dashboardUsers.length > 0
      ? usage.dashboardUsers
      : usage?.userBreakdown;

  if (!usage || !users || users.length === 0) {
    return html`
      <div style="text-align: center; padding: 48px 16px; color: var(--text-muted, #9ca3af)">
        <div style="font-size: 2rem; margin-bottom: 8px">👥</div>
        <div>No user data available yet.</div>
      </div>
    `;
  }

  const totalCost = usage.dashboardTotals?.totalCost ?? usage.totalCost;
  const sorted = sortUserBreakdown(users, sort, sortDir);
  const arrow = (field: ApolloUserSortField) =>
    sort === field ? (sortDir === "desc" ? " ▼" : " ▲") : "";
  const thStyle = "text-align: right; cursor: pointer; user-select: none; white-space: nowrap;";

  // Rank medal for top 3
  const medal = (i: number) => {
    if (sortDir !== "desc" || sort !== "cost") {
      return "";
    }
    if (i === 0) {
      return "🥇 ";
    }
    if (i === 1) {
      return "🥈 ";
    }
    if (i === 2) {
      return "🥉 ";
    }
    return "";
  };

  return html`
    <div style="
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px; gap: 8px; flex-wrap: wrap;
    ">
      <div style="font-size: 0.8rem; color: var(--text-muted, #9ca3af);">
        ${sorted.length} user${sorted.length !== 1 ? "s" : ""}
      </div>
      <select
        class="select select--sm"
        style="min-width: 180px; font-size: 0.8rem;"
        @change=${(e: Event) => onUserFilterChange((e.target as HTMLSelectElement).value)}
      >
        <option value="" ?selected=${!userFilter}>All Users</option>
        ${sorted.map(
          (u) => html`
            <option value="${u.userEmail}" ?selected=${userFilter === u.userEmail}>
              ${u.userDisplayName ?? u.userEmail}
            </option>
          `,
        )}
      </select>
    </div>

    <div style="
      background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb);
      border-radius: 12px; overflow: hidden;
    ">
      <div style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
          <thead>
            <tr style="background: var(--bg-table-header, rgba(0,0,0,0.02));">
              <th style="padding: 12px 16px; text-align: left;">User</th>
              <th style="padding: 12px 16px; ${thStyle}" @click=${() => onSortChange("requests")}>Requests${arrow("requests")}</th>
              <th style="padding: 12px 16px; ${thStyle}" @click=${() => onSortChange("tokens")}>Tokens${arrow("tokens")}</th>
              <th style="padding: 12px 16px; ${thStyle}" @click=${() => onSortChange("cost")}>Cost${arrow("cost")}</th>
              <th style="padding: 12px 16px; ${thStyle}" @click=${() => onSortChange("costPerRequest")}>$/Req${arrow("costPerRequest")}</th>
              <th style="padding: 12px 16px; text-align: right; white-space: nowrap;">Share</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((u, i) => {
              const requests = u.requests ?? 0;
              const tokens = u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
              const cost = u.cost ?? 0;
              const costPerReq = requests > 0 ? cost / requests : 0;
              const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
              const isSelected = userFilter === u.userEmail;
              return html`
                <tr
                  style="
                    cursor: pointer; transition: background 0.1s ease;
                    border-top: 1px solid var(--border-light, rgba(0,0,0,0.04));
                    ${isSelected ? "background: var(--bg-selected, rgba(99,102,241,0.06));" : ""}
                  "
                  @click=${() => onUserFilterChange(isSelected ? "" : u.userEmail)}
                >
                  <td style="padding: 12px 16px;">
                    <div style="font-weight: 500;">${medal(i)}${u.userDisplayName ?? u.userEmail.split("@")[0]}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted, #9ca3af);">${u.userEmail}</div>
                  </td>
                  <td style="padding: 12px 16px; text-align: right;" class="mono">${fmt(requests)}</td>
                  <td style="padding: 12px 16px; text-align: right;" class="mono">${fmt(tokens)}</td>
                  <td style="padding: 12px 16px; text-align: right; font-weight: 600;" class="mono">${fmtCost(cost)}</td>
                  <td style="padding: 12px 16px; text-align: right;" class="mono">${fmtCost(costPerReq)}</td>
                  <td style="padding: 12px 16px; text-align: right;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                      <div style="
                        width: 64px; height: 6px; border-radius: 3px; overflow: hidden;
                        background: var(--bg-muted, #e5e7eb);
                      ">
                        <div style="
                          width: ${Math.min(pct, 100)}%; height: 100%;
                          background: var(--accent, #6366f1); border-radius: 3px;
                          transition: width 0.3s ease;
                        "></div>
                      </div>
                      <span class="mono" style="min-width: 36px; font-size: 0.8rem;">${pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Tab: Recent Requests ────────────────────────────────────────────────

function renderRequestsTab(usage: ApolloUsageResult | null, userFilter: string) {
  if (!usage || usage.recentRequests.length === 0) {
    return html`
      <div style="text-align: center; padding: 48px 16px; color: var(--text-muted, #9ca3af)">
        <div style="font-size: 2rem; margin-bottom: 8px">📋</div>
        <div>No requests recorded yet.</div>
        <div style="font-size: 0.8rem; margin-top: 4px">
          Send a message to the agent to generate Apollo traffic.
        </div>
      </div>
    `;
  }

  const sourceLabel: Record<string, string> = {
    org: "Org",
    user_key: "User",
    user_oauth: "OAuth",
  };

  const filtered = userFilter
    ? usage.recentRequests.filter((r) => r.userEmail === userFilter)
    : usage.recentRequests;

  if (filtered.length === 0) {
    return html`
      <div style="text-align: center; padding: 48px 16px; color: var(--text-muted, #9ca3af)">
        <div>No requests match the selected user filter.</div>
      </div>
    `;
  }

  return html`
    <div style="font-size: 0.8rem; color: var(--text-muted, #9ca3af); margin-bottom: 12px;">
      Showing ${filtered.length} most recent request${filtered.length !== 1 ? "s" : ""}
      ${userFilter ? html` for <strong>${userFilter}</strong>` : nothing}
    </div>

    <div style="
      background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb);
      border-radius: 12px; overflow: hidden;
    ">
      <div style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.82rem; border-collapse: collapse;">
          <thead>
            <tr style="background: var(--bg-table-header, rgba(0,0,0,0.02));">
              <th style="padding: 10px 14px; text-align: left; white-space: nowrap;">Time</th>
              <th style="padding: 10px 14px; text-align: left;">Model</th>
              <th style="padding: 10px 14px; text-align: right;">In</th>
              <th style="padding: 10px 14px; text-align: right;">Out</th>
              <th style="padding: 10px 14px; text-align: right;">Cost</th>
              <th style="padding: 10px 14px; text-align: left;">Source</th>
              <th style="padding: 10px 14px; text-align: left;">User</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(
              (req) => html`
                <tr style="border-top: 1px solid var(--border-light, rgba(0,0,0,0.04));">
                  <td style="padding: 10px 14px; white-space: nowrap;" class="mono">${formatTimestamp(req.timestamp)}</td>
                  <td style="padding: 10px 14px;" class="mono">${shortModel(req.model)}</td>
                  <td style="padding: 10px 14px; text-align: right;" class="mono">${fmt(req.inputTokens)}</td>
                  <td style="padding: 10px 14px; text-align: right;" class="mono">${fmt(req.outputTokens)}</td>
                  <td style="padding: 10px 14px; text-align: right; font-weight: 500;" class="mono">${fmtCost(req.cost)}</td>
                  <td style="padding: 10px 14px;">
                    <span class="pill pill--sm" style="font-size: 0.72rem;">${sourceLabel[req.keySource] ?? req.keySource}</span>
                  </td>
                  <td style="padding: 10px 14px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                    title="${req.userEmail ?? ""}"
                  >
                    ${req.userDisplayName ?? req.userEmail ?? "—"}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Tab: Models ─────────────────────────────────────────────────────────

type ModelAggregate = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

function aggregateByModel(usage: ApolloUsageResult | null): ModelAggregate[] {
  if (!usage) {
    return [];
  }

  const map = new Map<string, ModelAggregate>();

  for (const req of usage.recentRequests) {
    const model = shortModel(req.model);
    const entry = map.get(model) ?? {
      model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };
    entry.requests += 1;
    entry.inputTokens += req.inputTokens ?? 0;
    entry.outputTokens += req.outputTokens ?? 0;
    entry.cost += req.cost ?? 0;
    map.set(model, entry);
  }

  return [...map.values()].toSorted((a, b) => b.cost - a.cost);
}

function renderModelsTab(usage: ApolloUsageResult | null) {
  const models = aggregateByModel(usage);

  if (models.length === 0) {
    return html`
      <div style="text-align: center; padding: 48px 16px; color: var(--text-muted, #9ca3af)">
        <div style="font-size: 2rem; margin-bottom: 8px">🤖</div>
        <div>No model data available yet.</div>
      </div>
    `;
  }

  const totalCost = models.reduce((sum, m) => sum + m.cost, 0);

  return html`
    <div style="font-size: 0.8rem; color: var(--text-muted, #9ca3af); margin-bottom: 12px;">
      ${models.length} model${models.length !== 1 ? "s" : ""} used
    </div>

    <div style="
      background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb);
      border-radius: 12px; overflow: hidden;
    ">
      <div style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
          <thead>
            <tr style="background: var(--bg-table-header, rgba(0,0,0,0.02));">
              <th style="padding: 12px 16px; text-align: left;">Model</th>
              <th style="padding: 12px 16px; text-align: right;">Requests</th>
              <th style="padding: 12px 16px; text-align: right;">Input Tokens</th>
              <th style="padding: 12px 16px; text-align: right;">Output Tokens</th>
              <th style="padding: 12px 16px; text-align: right;">Cost</th>
              <th style="padding: 12px 16px; text-align: right;">Avg $/Req</th>
              <th style="padding: 12px 16px; text-align: right;">Share</th>
            </tr>
          </thead>
          <tbody>
            ${models.map((m) => {
              const avgCost = m.requests > 0 ? m.cost / m.requests : 0;
              const pct = totalCost > 0 ? (m.cost / totalCost) * 100 : 0;
              return html`
                  <tr style="border-top: 1px solid var(--border-light, rgba(0,0,0,0.04));">
                    <td style="padding: 12px 16px; font-weight: 500;" class="mono">${m.model}</td>
                    <td style="padding: 12px 16px; text-align: right;" class="mono">${fmt(m.requests)}</td>
                    <td style="padding: 12px 16px; text-align: right;" class="mono">${fmt(m.inputTokens)}</td>
                    <td style="padding: 12px 16px; text-align: right;" class="mono">${fmt(m.outputTokens)}</td>
                    <td style="padding: 12px 16px; text-align: right; font-weight: 600;" class="mono">${fmtCost(m.cost)}</td>
                    <td style="padding: 12px 16px; text-align: right;" class="mono">${fmtCost(avgCost)}</td>
                    <td style="padding: 12px 16px; text-align: right;">
                      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                        <div style="
                          width: 64px; height: 6px; border-radius: 3px; overflow: hidden;
                          background: var(--bg-muted, #e5e7eb);
                        ">
                          <div style="
                            width: ${Math.min(pct, 100)}%; height: 100%;
                            background: var(--accent, #6366f1); border-radius: 3px;
                          "></div>
                        </div>
                        <span class="mono" style="min-width: 36px; font-size: 0.8rem;">${pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                `;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Main render ─────────────────────────────────────────────────────────

export function renderApollo(props: ApolloViewProps) {
  const tabContent = () => {
    switch (props.activeTab) {
      case "users":
        return renderUsersTab(
          props.usage,
          props.userSort,
          props.userSortDir,
          props.userFilter,
          props.onUserSortChange,
          props.onUserFilterChange,
        );
      case "requests":
        return renderRequestsTab(props.usage, props.userFilter);
      case "models":
        return renderModelsTab(props.usage);
    }
  };

  return html`
    <div class="page-title">Apollo Usage</div>
    <div class="page-sub" style="margin-bottom: 16px;">
      Organization-wide AI request traffic, cost breakdown, and per-user analytics.
    </div>

    ${
      props.error
        ? html`<div class="pill danger" style="margin-bottom: 16px;">${props.error}</div>`
        : nothing
    }

    ${renderConnectionBanner(props.status)}
    ${renderHeroStats(props.usage)}
    ${renderTabBar(props.activeTab, props.onTabChange, props.loading, props.onRefresh)}
    ${tabContent()}
  `;
}
