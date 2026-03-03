/**
 * Dashboard View
 *
 * Personalized landing page showing widgets for each connected MCP service.
 * Dynamically renders only the MCPs the user has connected.
 */

import { html, nothing } from "lit";
import type { MCPConnection } from "../controllers/agents.ts";
import {
  getMcpDisplayName,
  getConnectedMcpNames,
  hasWidgetConfig,
} from "../controllers/dashboard.ts";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import { renderAsanaWidget } from "./dashboard-asana.ts";
import { renderGitHubWidget } from "./dashboard-github.ts";
import { renderM365Widget } from "./dashboard-m365.ts";
import { renderMondayWidget } from "./dashboard-monday.ts";
import { renderSalesforceWidget } from "./dashboard-salesforce.ts";
import { renderSupabaseWidget } from "./dashboard-supabase.ts";
import { renderVercelWidget } from "./dashboard-vercel.ts";

export type DashboardViewProps = {
  loading: boolean;
  error: string | null;
  widgets: Record<string, DashboardWidgetData>;
  connections: MCPConnection[] | null;
  connectionsLoaded: boolean;
  lastRefreshAt: number | null;
  userName: string | null;
  onRefresh: () => void;
  onRefreshWidget: (mcpName: string) => void;
};

const WIDGET_RENDERERS: Record<
  string,
  (data: DashboardWidgetData, props: DashboardViewProps) => unknown
> = {
  m365: renderM365Widget,
  github: renderGitHubWidget,
  asana: renderAsanaWidget,
  salesforce: renderSalesforceWidget,
  monday: renderMondayWidget,
  supabase: renderSupabaseWidget,
  vercel: renderVercelWidget,
};

export function renderDashboard(props: DashboardViewProps) {
  const connectedMcps = getConnectedMcpNames(props.connections);
  const hasWidgets = connectedMcps.length > 0;

  return html`
    <div class="dashboard">
      <div class="dashboard-header">
        <div>
          <div class="page-title">
            ${props.userName ? `Welcome back, ${props.userName}` : "Dashboard"}
          </div>
          <div class="page-sub">
            Your connected services at a glance.
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${
            props.lastRefreshAt
              ? html`<span
                class="mono"
                style="font-size: 12px; opacity: 0.6; white-space: nowrap;"
                >Updated ${formatRelativeTime(props.lastRefreshAt)}</span
              >`
              : nothing
          }
          <button
            class="btn btn--sm"
            ?disabled=${props.loading}
            @click=${() => props.onRefresh()}
          >
            ${props.loading ? "Refreshing..." : "Refresh All"}
          </button>
        </div>
      </div>

      ${
        props.error
          ? html`<div class="pill danger" style="margin-bottom: 16px;">
            ${props.error}
          </div>`
          : nothing
      }
      ${
        !props.connectionsLoaded
          ? html`
              <div class="dashboard-loading">Loading your connections...</div>
            `
          : !hasWidgets
            ? renderEmptyState()
            : html`
              <div class="dashboard-grid">
                ${connectedMcps.map((mcpName) => {
                  const widget = props.widgets[mcpName];
                  const renderer = WIDGET_RENDERERS[mcpName];
                  if (renderer && widget) {
                    return renderer(widget, props);
                  }
                  if (hasWidgetConfig(mcpName)) {
                    return renderGenericWidget(mcpName, widget, props);
                  }
                  return renderConnectedBadge(mcpName);
                })}
              </div>
            `
      }
    </div>
  `;
}

function renderEmptyState() {
  return html`
    <div class="dashboard-empty">
      <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4">
        <svg
          viewBox="0 0 24 24"
          width="48"
          height="48"
          stroke="currentColor"
          fill="none"
          stroke-width="1.5"
        >
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
          <path
            d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
          />
        </svg>
      </div>
      <h3 style="margin: 0 0 8px">No services connected</h3>
      <p style="margin: 0; opacity: 0.7">
        Connect your work tools to see a personalized dashboard.<br />
        Go to <strong>Agents &gt; Tools</strong> to connect services like GitHub, Asana, M365, and more.
      </p>
    </div>
  `;
}

function renderGenericWidget(
  mcpName: string,
  widget: DashboardWidgetData | undefined,
  props: DashboardViewProps,
) {
  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">
          ${getMcpDisplayName(mcpName)}
        </span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget?.loading}
          @click=${() => props.onRefreshWidget(mcpName)}
        >
          Refresh
        </button>
      </div>
      <div class="dashboard-widget__body">
        ${
          widget?.loading
            ? html`
                <div class="dashboard-widget__loading">Loading...</div>
              `
            : nothing
        }
        ${widget?.error ? html`<div class="pill danger">${widget.error}</div>` : nothing}
        ${
          !widget?.loading && !widget?.error
            ? html`
                <p style="opacity: 0.6; margin: 0">Connected</p>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderConnectedBadge(mcpName: string) {
  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">
          ${getMcpDisplayName(mcpName)}
        </span>
        <span class="pill success" style="font-size: 11px;">Connected</span>
      </div>
      <div class="dashboard-widget__body">
        <p style="opacity: 0.6; margin: 0; font-size: 13px;">
          No dashboard widget available for this service yet.
        </p>
      </div>
    </div>
  `;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
