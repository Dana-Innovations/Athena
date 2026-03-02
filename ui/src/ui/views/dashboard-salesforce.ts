/**
 * Salesforce Dashboard Widget
 *
 * Shows open opportunities pipeline.
 */

import { html, nothing } from "lit";
import type { DashboardWidgetData } from "../types-dashboard.ts";
import type { DashboardViewProps } from "./dashboard.ts";

export function renderSalesforceWidget(widget: DashboardWidgetData, props: DashboardViewProps) {
  const records = extractRecords(widget.data?.pipeline);

  return html`
    <div class="dashboard-widget">
      <div class="dashboard-widget__header">
        <span class="dashboard-widget__title">Salesforce</span>
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${widget.loading}
          @click=${() => props.onRefreshWidget("salesforce")}
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
                Open Pipeline
                ${
                  records.length > 0
                    ? html`<span class="pill info" style="font-size: 11px; margin-left: 6px;">${records.length}</span>`
                    : nothing
                }
              </div>
              ${
                records.length === 0
                  ? html`
                      <p class="dashboard-widget__empty">No open opportunities</p>
                    `
                  : html`
                    <ul class="dashboard-widget__list">
                      ${records.slice(0, 8).map(
                        (r) => html`
                          <li class="dashboard-widget__list-item">
                            <div
                              style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                            >
                              ${r.Name ?? "Untitled"}
                            </div>
                            <div
                              style="font-size: 12px; opacity: 0.6; display: flex; gap: 8px;"
                            >
                              ${r.StageName ? html`<span>${r.StageName}</span>` : nothing}
                              ${
                                r.Amount != null
                                  ? html`<span
                                    >${formatCurrency(r.Amount)}</span
                                  >`
                                  : nothing
                              }
                              ${r.CloseDate ? html`<span>Close ${r.CloseDate}</span>` : nothing}
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

type SFRecord = {
  Id?: string;
  Name?: string;
  StageName?: string;
  Amount?: number;
  CloseDate?: string;
};

function extractRecords(data: unknown): SFRecord[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data as SFRecord[];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.records)) {
      return obj.records as SFRecord[];
    }
    if (obj.content && typeof obj.content === "string") {
      try {
        const parsed = JSON.parse(obj.content);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (Array.isArray(parsed?.records)) {
          return parsed.records;
        }
      } catch {
        // ignore
      }
    }
  }
  return [];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
