/**
 * GitHub Dashboard Widget
 *
 * Shows open pull requests.
 */

import { html, nothing } from "lit";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { DashboardViewProps } from "./dashboard.ts";

export function renderGitHubWidget(widget: DashboardWidgetData, props: DashboardViewProps) {
  const prs = extractPRs(widget.data?.pullRequests);

  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">GitHub</span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget.loading}
          @click=${() => props.onRefreshWidget("github")}
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
                Open Pull Requests
                ${
                  prs.length > 0
                    ? html`<span class="pill info" style="font-size: 11px; margin-left: 6px;">${prs.length}</span>`
                    : nothing
                }
              </div>
              ${
                prs.length === 0
                  ? html`
                      <p class="dashboard-widget__empty">No open pull requests</p>
                    `
                  : html`
                    <ul class="dashboard-widget__list">
                      ${prs.slice(0, 8).map(
                        (pr) => html`
                          <li class="dashboard-widget__list-item">
                            <div
                              style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                            >
                              ${pr.title ?? "Untitled"}
                            </div>
                            <div
                              style="font-size: 12px; opacity: 0.6; display: flex; gap: 8px;"
                            >
                              ${pr.repository ? html`<span>${pr.repository}</span>` : nothing}
                              <span>#${pr.number}</span>
                              ${pr.author ? html`<span>by ${pr.author}</span>` : nothing}
                              ${
                                pr.createdAt
                                  ? html`<span>${formatAge(pr.createdAt)}</span>`
                                  : nothing
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

type PRItem = {
  number?: number;
  title?: string;
  repository?: string;
  state?: string;
  createdAt?: string;
  author?: string;
};

function extractPRs(data: unknown): PRItem[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data as PRItem[];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // Handle various response shapes
    if (Array.isArray(obj.items)) {
      return obj.items as PRItem[];
    }
    if (Array.isArray(obj.pull_requests)) {
      return obj.pull_requests as PRItem[];
    }
    if (obj.content && typeof obj.content === "string") {
      try {
        const parsed = JSON.parse(obj.content);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (Array.isArray(parsed?.items)) {
          return parsed.items;
        }
      } catch {
        // ignore
      }
    }
  }
  return [];
}

function formatAge(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
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
