/**
 * Admin Users Sub-panel
 *
 * Displays a searchable table of all cortex_users with role, status,
 * department, and MCP access information.
 */

import { html } from "lit";
import type { AdminUser } from "../types-admin.ts";

export type AdminUsersProps = {
  users: AdminUser[] | null;
  filter: string;
  onFilterChange: (filter: string) => void;
};

function formatDate(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function renderMcpAccess(mcp: Record<string, unknown> | null) {
  if (!mcp || Object.keys(mcp).length === 0) {
    return html`
      <span class="muted">-</span>
    `;
  }
  return html`${Object.keys(mcp).map(
    (name) => html`<span class="pill pill--sm" style="margin-right: 4px;">${name}</span>`,
  )}`;
}

export function renderAdminUsers(props: AdminUsersProps) {
  const { users, filter } = props;

  if (!users) {
    return html`
      <div class="card">
        <div class="card-body"><span class="muted">No user data available.</span></div>
      </div>
    `;
  }

  const lowerFilter = filter.toLowerCase();
  const filtered = lowerFilter
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(lowerFilter) ||
          (u.full_name ?? "").toLowerCase().includes(lowerFilter) ||
          (u.department ?? "").toLowerCase().includes(lowerFilter),
      )
    : users;

  return html`
    <div style="margin-bottom: 12px;">
      <input
        type="text"
        class="input input--sm"
        placeholder="Search by email, name, or department..."
        .value=${filter}
        @input=${(e: Event) => props.onFilterChange((e.target as HTMLInputElement).value)}
        style="width: 100%; max-width: 400px;"
      />
      <span class="muted" style="margin-left: 8px;">${filtered.length} of ${users.length} users</span>
    </div>

    <div class="card">
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Department</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Active</th>
              <th>MCP Access</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length === 0
                ? html`
                    <tr>
                      <td colspan="7" class="muted" style="text-align: center">No users match the filter.</td>
                    </tr>
                  `
                : filtered.map(
                    (user) => html`
                    <tr>
                      <td class="mono" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${user.email}">${user.email}</td>
                      <td>${user.full_name ?? "-"}</td>
                      <td>${user.department ?? "-"}</td>
                      <td><span class="pill pill--sm ${user.role === "admin" ? "warning" : ""}">${user.role}</span></td>
                      <td><span class="pill pill--sm ${user.status === "active" ? "success" : "danger"}">${user.status}</span></td>
                      <td class="mono">${formatDate(user.last_active_at)}</td>
                      <td>${renderMcpAccess(user.mcp_access)}</td>
                    </tr>
                  `,
                  )
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}
