/**
 * Monday.com Dashboard Widget
 *
 * Shows board items assigned to the user.
 */

import { html, nothing } from "lit";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { DashboardViewProps } from "./dashboard.ts";

export function renderMondayWidget(widget: DashboardWidgetData, props: DashboardViewProps) {
  const items = extractItems(widget.data?.items);

  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">Monday.com</span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget.loading}
          @click=${() => props.onRefreshWidget("monday")}
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
                My Items
                ${
                  items.length > 0
                    ? html`<span class="pill info" style="font-size: 11px; margin-left: 6px;">${items.length}</span>`
                    : nothing
                }
              </div>
              ${
                items.length === 0
                  ? html`
                      <p class="dashboard-widget__empty">No items</p>
                    `
                  : html`
                    <ul class="dashboard-widget__list">
                      ${items.slice(0, 8).map(
                        (item) => html`
                          <li class="dashboard-widget__list-item">
                            <div
                              style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                            >
                              ${item.name ?? "Untitled"}
                            </div>
                            <div
                              style="font-size: 12px; opacity: 0.6; display: flex; gap: 8px;"
                            >
                              ${item.board?.name ? html`<span>${item.board.name}</span>` : nothing}
                              ${item.status ? html`<span>${item.status}</span>` : nothing}
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

type MondayItem = {
  id?: string;
  name?: string;
  board?: { name?: string };
  status?: string;
  date?: string;
};

function extractItems(data: unknown): MondayItem[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data as MondayItem[];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      return obj.items as MondayItem[];
    }
    if (Array.isArray(obj.data)) {
      return obj.data as MondayItem[];
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
