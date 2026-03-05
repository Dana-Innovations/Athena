/**
 * Admin Activity Log View
 *
 * Renders a filterable, paginated table of all user activity
 * across AI and MCP services. Rows are expandable to show full details.
 */

import { html, nothing } from "lit";
import type {
  AdminActivityEntry,
  AdminActivityFilters,
  AdminActivityFilterOptions,
  AdminActivityLogResponse,
} from "../types-admin.ts";

export type AdminActivityLogProps = {
  log: AdminActivityLogResponse | null;
  loading: boolean;
  filters: AdminActivityFilters;
  filterOptions: AdminActivityFilterOptions | null;
  expandedId: string | null;
  onFilterChange: (key: keyof AdminActivityFilters, value: string | null) => void;
  onPageChange: (page: number) => void;
  onToggleExpand: (id: string) => void;
  onRefresh: () => void;
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) {
    return "just now";
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)}m ago`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.floor(diffMs / 3_600_000)}h ago`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFullTimestamp(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function formatDuration(ms: number | null): string {
  if (ms == null) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number | null): string {
  if (tokens == null) {
    return "—";
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

function formatCost(cost: number | null): string {
  if (cost == null) {
    return "—";
  }
  return `$${cost.toFixed(4)}`;
}

function renderFilters(props: AdminActivityLogProps) {
  const { filters, filterOptions } = props;
  const users = filterOptions?.users ?? [];

  return html`
    <div class="activity-log__filters">
      <select
        class="activity-log__select"
        .value=${filters.user_id ?? ""}
        @change=${(e: Event) =>
          props.onFilterChange("user_id", (e.target as HTMLSelectElement).value || null)}
      >
        <option value="">All Users</option>
        ${users.map(
          (u) => html`<option value=${u.id} ?selected=${filters.user_id === u.id}>
            ${u.name ?? u.email}
          </option>`,
        )}
      </select>

      <select
        class="activity-log__select"
        .value=${filters.service ?? ""}
        @change=${(e: Event) =>
          props.onFilterChange("service", (e.target as HTMLSelectElement).value || null)}
      >
        <option value="">All Services</option>
        <option value="ai" ?selected=${filters.service === "ai"}>AI</option>
        <option value="mcp" ?selected=${filters.service === "mcp"}>MCP</option>
      </select>

      <select
        class="activity-log__select"
        .value=${filters.status ?? ""}
        @change=${(e: Event) =>
          props.onFilterChange("status", (e.target as HTMLSelectElement).value || null)}
      >
        <option value="">All Status</option>
        <option value="success" ?selected=${filters.status === "success"}>Success</option>
        <option value="error" ?selected=${filters.status === "error"}>Errors</option>
      </select>

      <input
        type="text"
        class="activity-log__search"
        placeholder="Search actions, tools, models..."
        .value=${filters.search ?? ""}
        @input=${(e: Event) => {
          const val = (e.target as HTMLInputElement).value;
          props.onFilterChange("search", val || null);
        }}
      />

      <input
        type="date"
        class="activity-log__date"
        .value=${filters.date_from ?? ""}
        @change=${(e: Event) =>
          props.onFilterChange("date_from", (e.target as HTMLInputElement).value || null)}
      />
      <input
        type="date"
        class="activity-log__date"
        .value=${filters.date_to ?? ""}
        @change=${(e: Event) =>
          props.onFilterChange("date_to", (e.target as HTMLInputElement).value || null)}
      />
    </div>
  `;
}

function renderDetailRow(entry: AdminActivityEntry) {
  const hasError = entry.error_message || entry.error_code;
  const hasParams = entry.params_summary && Object.keys(entry.params_summary).length > 0;

  return html`
    <tr class="activity-log__detail-row">
      <td colspan="9" class="activity-log__detail-cell">
        <div class="activity-log__detail">
          ${
            hasError
              ? html`
                <div class="activity-log__detail-section">
                  <div class="activity-log__detail-label">Error</div>
                  <div class="activity-log__detail-value activity-log__detail-value--error">
                    ${
                      entry.error_code
                        ? html`<span class="activity-log__error-code">${entry.error_code}</span>`
                        : nothing
                    }
                    ${entry.error_message ?? "Unknown error"}
                  </div>
                </div>
              `
              : nothing
          }

          ${
            hasParams
              ? html`
                <div class="activity-log__detail-section">
                  <div class="activity-log__detail-label">Parameters</div>
                  <pre class="activity-log__detail-pre">${JSON.stringify(entry.params_summary, null, 2)}</pre>
                </div>
              `
              : nothing
          }

          ${
            entry.result_preview
              ? html`
                <div class="activity-log__detail-section">
                  <div class="activity-log__detail-label">Result Preview</div>
                  <pre class="activity-log__detail-pre">${entry.result_preview}</pre>
                </div>
              `
              : nothing
          }

          <div class="activity-log__detail-grid">
            <div class="activity-log__detail-item">
              <span class="activity-log__detail-label">Timestamp</span>
              <span>${formatFullTimestamp(entry.timestamp)}</span>
            </div>
            <div class="activity-log__detail-item">
              <span class="activity-log__detail-label">User</span>
              <span>${entry.user_email}</span>
            </div>
            ${
              entry.model
                ? html`
                  <div class="activity-log__detail-item">
                    <span class="activity-log__detail-label">Model</span>
                    <span>${entry.model}</span>
                  </div>
                `
                : nothing
            }
            ${
              entry.mcp_name
                ? html`
                  <div class="activity-log__detail-item">
                    <span class="activity-log__detail-label">MCP</span>
                    <span>${entry.mcp_name}</span>
                  </div>
                `
                : nothing
            }
            ${
              entry.tool_name
                ? html`
                  <div class="activity-log__detail-item">
                    <span class="activity-log__detail-label">Tool</span>
                    <span>${entry.tool_name}</span>
                  </div>
                `
                : nothing
            }
            ${
              entry.status_code != null
                ? html`
                  <div class="activity-log__detail-item">
                    <span class="activity-log__detail-label">Status Code</span>
                    <span>${entry.status_code}</span>
                  </div>
                `
                : nothing
            }
            ${
              entry.tokens != null
                ? html`
                  <div class="activity-log__detail-item">
                    <span class="activity-log__detail-label">Tokens</span>
                    <span>${entry.tokens.toLocaleString()}</span>
                  </div>
                `
                : nothing
            }
            ${
              entry.cost != null
                ? html`
                  <div class="activity-log__detail-item">
                    <span class="activity-log__detail-label">Cost</span>
                    <span>$${entry.cost.toFixed(6)}</span>
                  </div>
                `
                : nothing
            }
            <div class="activity-log__detail-item">
              <span class="activity-log__detail-label">Duration</span>
              <span>${formatDuration(entry.duration_ms)}</span>
            </div>
            <div class="activity-log__detail-item">
              <span class="activity-log__detail-label">ID</span>
              <span class="activity-log__detail-mono">${entry.id}</span>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderRow(entry: AdminActivityEntry, isExpanded: boolean, onToggle: (id: string) => void) {
  const serviceBadgeClass =
    entry.service === "ai" ? "activity-log__badge--ai" : "activity-log__badge--mcp";
  const statusClass =
    entry.status === "error" ? "activity-log__status--error" : "activity-log__status--success";

  return html`
    <tr
      class="activity-log__row activity-log__row--expandable ${isExpanded ? "activity-log__row--expanded" : ""}"
      @click=${() => onToggle(entry.id)}
    >
      <td class="activity-log__cell activity-log__cell--time">
        <span class="activity-log__chevron ${isExpanded ? "activity-log__chevron--open" : ""}">&#9656;</span>
        ${formatTimestamp(entry.timestamp)}
      </td>
      <td class="activity-log__cell">${entry.user_name ?? entry.user_email}</td>
      <td class="activity-log__cell">
        <span class="activity-log__badge ${serviceBadgeClass}">${entry.service.toUpperCase()}</span>
      </td>
      <td class="activity-log__cell activity-log__cell--action">${entry.action}</td>
      <td class="activity-log__cell activity-log__cell--detail">${entry.detail ?? "—"}</td>
      <td class="activity-log__cell">
        <span class="activity-log__status ${statusClass}">
          <span class="activity-log__dot"></span>
          ${entry.status}
        </span>
      </td>
      <td class="activity-log__cell activity-log__cell--num">${formatTokens(entry.tokens)}</td>
      <td class="activity-log__cell activity-log__cell--num">${formatCost(entry.cost)}</td>
      <td class="activity-log__cell activity-log__cell--num">${formatDuration(entry.duration_ms)}</td>
    </tr>
    ${isExpanded ? renderDetailRow(entry) : nothing}
  `;
}

function renderPagination(props: AdminActivityLogProps) {
  const log = props.log;
  if (!log || log.total_count <= log.page_size) {
    return nothing;
  }

  const totalPages = Math.ceil(log.total_count / log.page_size);
  const page = log.page;

  return html`
    <div class="activity-log__pagination">
      <button
        class="btn btn--sm"
        ?disabled=${page <= 1}
        @click=${() => props.onPageChange(page - 1)}
      >Prev</button>
      <span class="activity-log__page-info">
        Page ${page} of ${totalPages}
        <span class="text-muted">(${log.total_count.toLocaleString()} total)</span>
      </span>
      <button
        class="btn btn--sm"
        ?disabled=${page >= totalPages}
        @click=${() => props.onPageChange(page + 1)}
      >Next</button>
    </div>
  `;
}

function renderLoading() {
  return html`
    <div class="activity-log__loading">
      <div class="spinner"></div>
      <span>Loading activity log...</span>
    </div>
  `;
}

function renderEmpty() {
  return html`
    <div class="activity-log__empty">No activity found matching the current filters.</div>
  `;
}

export function renderAdminActivityLog(props: AdminActivityLogProps) {
  const entries = props.log?.entries ?? [];

  return html`
    <div class="activity-log">
      ${renderFilters(props)}

      ${props.loading && !props.log ? renderLoading() : nothing}

      ${!props.loading && props.log && entries.length === 0 ? renderEmpty() : nothing}

      ${
        entries.length > 0
          ? html`
            <div class="activity-log__table-wrap">
              ${
                props.loading
                  ? html`
                      <div class="activity-log__overlay"></div>
                    `
                  : nothing
              }
              <table class="activity-log__table">
                <thead>
                  <tr>
                    <th class="activity-log__th">Time</th>
                    <th class="activity-log__th">User</th>
                    <th class="activity-log__th">Service</th>
                    <th class="activity-log__th">Action</th>
                    <th class="activity-log__th">Detail</th>
                    <th class="activity-log__th">Status</th>
                    <th class="activity-log__th activity-log__th--num">Tokens</th>
                    <th class="activity-log__th activity-log__th--num">Cost</th>
                    <th class="activity-log__th activity-log__th--num">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  ${entries.map((e) => renderRow(e, props.expandedId === e.id, props.onToggleExpand))}
                </tbody>
              </table>
            </div>
          `
          : nothing
      }

      ${renderPagination(props)}
    </div>
  `;
}
