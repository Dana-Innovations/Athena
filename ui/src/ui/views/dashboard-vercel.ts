/**
 * Vercel Dashboard Widget
 *
 * Shows recent deployments.
 */

import { html, nothing } from "lit";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { DashboardViewProps } from "./dashboard.ts";

export function renderVercelWidget(widget: DashboardWidgetData, props: DashboardViewProps) {
  const deployments = extractDeployments(widget.data?.deployments);

  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">Vercel</span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget.loading}
          @click=${() => props.onRefreshWidget("vercel")}
        >
          Refresh
        </button>
      </div>
      <div class="dashboard-widget__body">
        ${
          widget.loading
            ? html`
                <div class="dashboard-widget__loading">Loading...</div>
              `
            : nothing
        }
        ${widget.error ? html`<div class="pill danger">${widget.error}</div>` : nothing}
        ${
          !widget.loading && !widget.error
            ? html`
              <div class="dashboard-widget__section-title">
                Recent Deployments
                ${
                  deployments.length > 0
                    ? html`<span class="pill info" style="font-size: 11px; margin-left: 6px;">${deployments.length}</span>`
                    : nothing
                }
              </div>
              ${
                deployments.length === 0
                  ? html`
                      <p class="dashboard-widget__empty">No deployments</p>
                    `
                  : html`
                    <ul class="dashboard-widget__list">
                      ${deployments.slice(0, 6).map(
                        (d) => html`
                          <li class="dashboard-widget__list-item">
                            <div
                              style="display: flex; align-items: center; gap: 8px;"
                            >
                              <span
                                class="pill ${stateClass(d.state)}"
                                style="font-size: 10px; padding: 1px 6px;"
                                >${d.state ?? "unknown"}</span
                              >
                              <span
                                style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                                >${d.name ?? "Unknown"}</span
                              >
                            </div>
                            <div
                              style="font-size: 12px; opacity: 0.6; display: flex; gap: 8px; margin-top: 2px;"
                            >
                              ${d.target ? html`<span>${d.target}</span>` : nothing}
                              ${
                                d.createdAt ? html`<span>${formatAge(d.createdAt)}</span>` : nothing
                              }
                            </div>
                          </li>
                        `,
                      )}
                    </ul>
                  `
              }
            `
            : nothing
        }
      </div>
    </div>
  `;
}

type DeploymentItem = {
  uid?: string;
  name?: string;
  url?: string;
  state?: string;
  createdAt?: number | string;
  target?: string;
};

function extractDeployments(data: unknown): DeploymentItem[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data as DeploymentItem[];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.deployments)) {
      return obj.deployments as DeploymentItem[];
    }
    if (Array.isArray(obj.data)) {
      return obj.data as DeploymentItem[];
    }
    if (obj.content && typeof obj.content === "string") {
      try {
        const parsed = JSON.parse(obj.content);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (Array.isArray(parsed?.deployments)) {
          return parsed.deployments;
        }
      } catch {
        // ignore
      }
    }
  }
  return [];
}

function stateClass(state: string | undefined): string {
  switch (state?.toUpperCase()) {
    case "READY":
      return "success";
    case "ERROR":
      return "danger";
    case "BUILDING":
    case "INITIALIZING":
      return "warning";
    case "CANCELED":
    case "CANCELLED":
      return "";
    default:
      return "";
  }
}

function formatAge(createdAt: number | string): string {
  try {
    const ts = typeof createdAt === "number" ? createdAt : new Date(createdAt).getTime();
    const diff = Date.now() - ts;
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) {
      return "just now";
    }
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    if (days === 1) {
      return "1d ago";
    }
    return `${days}d ago`;
  } catch {
    return "";
  }
}
