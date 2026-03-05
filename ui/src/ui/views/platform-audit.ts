/**
 * Audit Log View
 *
 * Shows audit events filterable by agent, event type, and date range.
 */
import { html, nothing } from "lit";
import type { PlatformAuditEvent } from "../controllers/platform.ts";

export type AuditViewProps = {
  loading: boolean;
  error: string | null;
  events: PlatformAuditEvent[] | null;
  filter: {
    agentId?: string;
    eventType?: string;
  };
  onFilterChange: (filter: Record<string, string | undefined>) => void;
  onRefresh: () => void;
};

export function renderPlatformAudit(props: AuditViewProps) {
  return html`
    <div class="page-title">Audit Log</div>
    <div class="page-sub">All tool calls, config changes, and admin actions across the platform.</div>

    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center;">
      <input
        type="text"
        class="input"
        placeholder="Filter by agent..."
        style="width: 150px; padding: 6px 10px; font-size: 13px;"
        .value=${props.filter.agentId ?? ""}
        @input=${(e: Event) => props.onFilterChange({ agentId: (e.target as HTMLInputElement).value || undefined })}
      />
      <select
        class="input"
        style="width: 180px; padding: 6px 10px; font-size: 13px;"
        @change=${(e: Event) => props.onFilterChange({ eventType: (e.target as HTMLSelectElement).value || undefined })}
      >
        <option value="">All events</option>
        <option value="tool_call" ?selected=${props.filter.eventType === "tool_call"}>Tool Calls</option>
        <option value="agent_config_change" ?selected=${props.filter.eventType === "agent_config_change"}>Config Changes</option>
        <option value="agent_message" ?selected=${props.filter.eventType === "agent_message"}>Agent Messages</option>
        <option value="admin_action" ?selected=${props.filter.eventType === "admin_action"}>Admin Actions</option>
      </select>
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
      >${props.loading ? "Loading..." : "Refresh"}</button>
    </div>

    ${props.error ? html`<div class="pill danger" style="margin-bottom: 12px;">${props.error}</div>` : nothing}
    ${renderEventList(props)}
  `;
}

function renderEventList(props: AuditViewProps) {
  if (!props.events || props.events.length === 0) {
    return html`
      <div style="text-align: center; padding: 40px; opacity: 0.5;">
        ${props.loading ? "Loading audit events..." : "No audit events found."}
      </div>
    `;
  }

  return html`
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border, #333);">
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Time</th>
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Type</th>
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Agent</th>
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Action</th>
            <th style="text-align: left; padding: 8px 12px; opacity: 0.6; font-weight: 500;">Details</th>
          </tr>
        </thead>
        <tbody>
          ${props.events.map(
            (ev) => html`
              <tr style="border-bottom: 1px solid var(--border, #222);">
                <td style="padding: 8px 12px; white-space: nowrap;" class="mono">
                  ${formatTime(ev.createdAt)}
                </td>
                <td style="padding: 8px 12px;">
                  <span class="pill ${eventTypePillClass(ev.eventType)}" style="font-size: 11px;">${ev.eventType}</span>
                </td>
                <td style="padding: 8px 12px;">${ev.agentId ?? "—"}</td>
                <td style="padding: 8px 12px; font-weight: 500;">${ev.action}</td>
                <td style="padding: 8px 12px; font-size: 12px; opacity: 0.6; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${ev.details ? JSON.stringify(ev.details).slice(0, 120) : "—"}
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function eventTypePillClass(type: string): string {
  switch (type) {
    case "tool_call":
      return "";
    case "agent_config_change":
      return "warning";
    case "admin_action":
      return "info";
    default:
      return "";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
