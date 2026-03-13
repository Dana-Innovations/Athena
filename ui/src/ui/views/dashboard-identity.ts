/**
 * Dashboard Identity View
 *
 * Personal AI identity hub. Shows who you are, what you're connected to,
 * and how you've been using your AI.
 */

import { html, nothing } from "lit";
import type { MCPConnection } from "../controllers/agents.ts";
import type { DashboardStats } from "../controllers/dashboard-stats.ts";
import type { CortexAuthSession } from "../cortex-auth.ts";

export type IdentityDashboardProps = {
  user: CortexAuthSession | null;
  connections: MCPConnection[] | null;
  connectionsLoaded: boolean;
  dashboardStats: DashboardStats | null;
  dashboardStatsLoading: boolean;
  connected: boolean;
  onLoadConnections: () => void;
  onConnectMcp: (mcpName: string) => void;
};

const AVAILABLE_MCPS = [
  { name: "asana", display: "Asana", auth: "personal" as const, icon: "\u2611" },
  { name: "github", display: "GitHub", auth: "company" as const, icon: "\u2B22" },
  { name: "mailchimp", display: "Mailchimp", auth: "personal" as const, icon: "\u2709" },
  { name: "vercel", display: "Vercel", auth: "company" as const, icon: "\u25B2" },
  { name: "supabase", display: "Supabase", auth: "company" as const, icon: "\u26A1" },
  { name: "m365", display: "Microsoft 365", auth: "personal" as const, icon: "\u229E" },
  { name: "salesforce", display: "Salesforce", auth: "personal" as const, icon: "\u2601" },
  { name: "monday", display: "Monday.com", auth: "personal" as const, icon: "\u25CE" },
  { name: "slack", display: "Slack", auth: "personal" as const, icon: "#" },
  { name: "powerbi", display: "Power BI", auth: "personal" as const, icon: "\u2593" },
  { name: "bestbuy", display: "Best Buy", auth: "company" as const, icon: "\u2605" },
  { name: "databricks", display: "Databricks", auth: "company" as const, icon: "\u25C6" },
];

function isConnected(mcpName: string, connections: MCPConnection[] | null): MCPConnection | null {
  if (!connections) {
    return null;
  }
  return connections.find((c) => c.mcp_name === mcpName && c.status === "active") ?? null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 100) {
    return `$${Math.round(n)}`;
  }
  return `$${n.toFixed(2)}`;
}

export function renderDashboardIdentity(props: IdentityDashboardProps) {
  const userName = props.user?.displayName ?? props.user?.email?.split("@")[0] ?? "there";
  const userEmail = props.user?.email ?? "";
  const userRole = props.user?.role ?? "user";

  const connectedCount = AVAILABLE_MCPS.filter((mcp) =>
    isConnected(mcp.name, props.connections),
  ).length;

  return html`
    <div class="identity-dashboard">
      <!-- Identity Hero -->
      <section class="identity-hero">
        <div class="identity-hero__orb">
          <div class="cortex-orb">
            <div class="cortex-orb-glow"></div>
            <div class="cortex-orb-ring"></div>
            <div class="cortex-orb-sphere">
              <div class="cortex-orb-highlight"></div>
              <div class="cortex-orb-inner-ring"></div>
            </div>
          </div>
        </div>
        <div class="identity-hero__info">
          <h1 class="identity-hero__greeting">Welcome back, ${userName}</h1>
          <p class="identity-hero__email">${userEmail}</p>
          <div class="identity-hero__badges">
            <span class="identity-badge identity-badge--role">${userRole}</span>
            <span class="identity-badge identity-badge--status ${props.connected ? "identity-badge--online" : ""}">
              <span class="statusDot ${props.connected ? "ok" : ""}"></span>
              ${props.connected ? "Online" : "Offline"}
            </span>
            ${
              props.connectionsLoaded
                ? html`<span class="identity-badge identity-badge--connections">
                    ${connectedCount} service${connectedCount !== 1 ? "s" : ""} connected
                  </span>`
                : nothing
            }
          </div>
        </div>
      </section>

      <!-- Usage Stats -->
      ${renderUsageStats(props)}

      <!-- Cortex Connections -->
      <section class="identity-section">
        <div class="identity-section__header">
          <h2 class="identity-section__title">Cortex MCP Connections</h2>
          <p class="identity-section__sub">Services your AI can access through Cortex</p>
        </div>
        ${
          !props.connectionsLoaded
            ? html`
                <div class="identity-loading">Loading connections...</div>
              `
            : html`
              <div class="identity-connections">
                ${AVAILABLE_MCPS.map((mcp) => {
                  const conn = isConnected(mcp.name, props.connections);
                  return renderConnectionCard(mcp, conn, props);
                })}
              </div>
            `
        }
      </section>

      <!-- Athena Agents Placeholder -->
      <section class="identity-section">
        <div class="identity-section__header">
          <h2 class="identity-section__title">Athena Agents</h2>
          <p class="identity-section__sub">AI agents you own and manage</p>
        </div>
        <div class="identity-placeholder">
          <div class="identity-placeholder__icon">
            <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" stroke-width="1.5">
              <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Z"/>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="6" r="4"/>
            </svg>
          </div>
          <h3 class="identity-placeholder__title">Coming Soon</h3>
          <p class="identity-placeholder__text">
            Create and manage your personal AI agents. Configure their behavior,
            connect them to your services, and deploy them to work for you.
          </p>
        </div>
      </section>
    </div>
  `;
}

function renderUsageStats(props: IdentityDashboardProps) {
  if (props.dashboardStatsLoading && !props.dashboardStats) {
    return html`
      <section class="identity-stats">
        <div class="identity-loading">Loading usage data...</div>
      </section>
    `;
  }

  const ai = props.dashboardStats?.ai;
  const mcp = props.dashboardStats?.mcp;

  const aiRequests = ai?.total_requests ?? 0;
  const totalTokens = ai?.total_tokens ?? 0;
  const totalCost = ai?.total_cost_dollars ?? 0;
  const toolCalls = mcp?.total_tool_calls ?? 0;
  const mcpsUsed = mcp?.mcps_used ?? 0;
  const activeDays = Math.max(ai?.active_days ?? 0, mcp?.active_days ?? 0);

  return html`
    <section class="identity-stats">
      <div class="identity-stats__header">
        <h2 class="identity-stats__title">Activity</h2>
        <span class="identity-stats__period">Last 30 days</span>
      </div>
      <div class="identity-stat">
        <span class="identity-stat__value">${formatTokens(aiRequests)}</span>
        <span class="identity-stat__label">AI Requests</span>
      </div>
      <div class="identity-stat">
        <span class="identity-stat__value">${formatTokens(totalTokens)}</span>
        <span class="identity-stat__label">Tokens Used</span>
      </div>
      <div class="identity-stat">
        <span class="identity-stat__value">${formatCost(totalCost)}</span>
        <span class="identity-stat__label">Total Cost</span>
      </div>
      <div class="identity-stat">
        <span class="identity-stat__value">${formatTokens(toolCalls)}</span>
        <span class="identity-stat__label">Tool Calls</span>
      </div>
      <div class="identity-stat">
        <span class="identity-stat__value">${mcpsUsed}</span>
        <span class="identity-stat__label">MCPs Used</span>
      </div>
      <div class="identity-stat">
        <span class="identity-stat__value">${activeDays}</span>
        <span class="identity-stat__label">Active Days</span>
      </div>
    </section>
  `;
}

function renderConnectionCard(
  mcp: (typeof AVAILABLE_MCPS)[number],
  conn: MCPConnection | null,
  props: IdentityDashboardProps,
) {
  const connected = Boolean(conn);
  const accountEmail = conn?.account_email;
  const isCompany = mcp.auth === "company";

  return html`
    <div class="identity-conn ${connected ? "identity-conn--active" : ""}">
      <div class="identity-conn__header">
        <span class="identity-conn__icon">${mcp.icon}</span>
        <span class="identity-conn__name">${mcp.display}</span>
        <span class="identity-conn__status ${connected ? "identity-conn__status--on" : ""}">
          <span class="statusDot ${connected ? "ok" : ""}"></span>
        </span>
      </div>
      <div class="identity-conn__body">
        ${
          connected
            ? html`
              <span class="identity-conn__detail">
                ${accountEmail ? accountEmail : isCompany ? "Company default" : "Connected"}
              </span>
            `
            : html`
              <span class="identity-conn__detail identity-conn__detail--muted">
                ${isCompany ? "Company default \u2014 auto-connected" : "Not connected"}
              </span>
            `
        }
      </div>
      ${
        !connected && !isCompany
          ? html`
            <button
              class="btn btn--sm identity-conn__action"
              @click=${() => props.onConnectMcp(mcp.name)}
            >
              Connect
            </button>
          `
          : nothing
      }
    </div>
  `;
}
