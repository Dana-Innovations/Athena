/**
 * Supabase Dashboard Widget
 *
 * Shows database tables.
 */

import { html, nothing } from "lit";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { DashboardViewProps } from "./dashboard.ts";

export function renderSupabaseWidget(widget: DashboardWidgetData, props: DashboardViewProps) {
  const tables = extractTables(widget.data?.tables);

  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">Supabase</span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget.loading}
          @click=${() => props.onRefreshWidget("supabase")}
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
                Public Tables
                ${
                  tables.length > 0
                    ? html`<span class="pill info" style="font-size: 11px; margin-left: 6px;">${tables.length}</span>`
                    : nothing
                }
              </div>
              ${
                tables.length === 0
                  ? html`
                      <p class="dashboard-widget__empty">No tables</p>
                    `
                  : html`
                    <ul class="dashboard-widget__list">
                      ${tables.slice(0, 10).map(
                        (t) => html`
                          <li class="dashboard-widget__list-item">
                            <div style="display: flex; align-items: center; gap: 8px;">
                              <code
                                style="font-size: 13px; font-weight: 500;"
                                >${t.name}</code
                              >
                              <span
                                style="font-size: 11px; opacity: 0.5;"
                                >${t.schema ?? "public"}</span
                              >
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

type TableItem = {
  name: string;
  schema?: string;
  rowCount?: number;
};

function extractTables(data: unknown): TableItem[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data as TableItem[];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.tables)) {
      return obj.tables as TableItem[];
    }
    if (Array.isArray(obj.data)) {
      return obj.data as TableItem[];
    }
    if (obj.content && typeof obj.content === "string") {
      try {
        const parsed = JSON.parse(obj.content);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (Array.isArray(parsed?.tables)) {
          return parsed.tables;
        }
      } catch {
        // ignore
      }
    }
  }
  return [];
}
