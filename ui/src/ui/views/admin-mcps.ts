/**
 * Admin MCP Access Page
 *
 * Displays MCP user access grouped by user with expandable rows.
 * Admins can grant or revoke user access to individual MCPs,
 * plus bulk grant-all / revoke-all per MCP.
 */

import { html, nothing } from "lit";
import type {
  AdminMcpUserAccessGrant,
  AdminMcpUserAccessSummary,
  AdminUser,
  AdminUserMcpRow,
  McpGroup,
} from "../types-admin.ts";

export type McpSortColumn = "email" | "name" | "granted" | "connected";
export type McpSortDir = "asc" | "desc";

export type McpSetupConfigItem = {
  mcp_name: string;
  display_name: string;
  enabled_in_setup: boolean;
};

export type AdminMcpsProps = {
  mcps: AdminMcpUserAccessSummary[] | null;
  users: AdminUser[] | null;
  userConnections: Record<string, string[]> | null;
  expandedMcpName: string | null;
  onToggleMcp: (mcpName: string) => void;
  expandedUserId: string | null;
  onToggleUser: (userId: string) => void;
  sortColumn: McpSortColumn;
  sortDir: McpSortDir;
  onSort: (column: McpSortColumn) => void;
  onGrant: (userId: string, mcpName: string) => void;
  onRevoke: (userId: string, mcpName: string) => void;
  onGrantAll: (mcpName: string) => void;
  onRevokeAll: (mcpName: string) => void;
  onSeed: () => void;
  mcpSetupConfig: McpSetupConfigItem[] | null;
  onToggleSetup: (mcpName: string, enabled: boolean) => void;
  // Groups
  groups: McpGroup[] | null;
  expandedGroupId: string | null;
  groupCreating: boolean;
  onToggleGroup: (groupId: string) => void;
  onCreateGroup: (name: string, description: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddGroupMembers: (groupId: string, userIds: string[]) => void;
  onRemoveGroupMember: (groupId: string, userId: string) => void;
  onGrantGroupAccess: (groupId: string, mcpName: string) => void;
  onRevokeGroupAccess: (groupId: string, mcpName: string) => void;
  onShowCreateGroup: () => void;
  loading?: boolean;
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

function grantSourcePill(source: string) {
  const cls =
    source === "admin"
      ? "success"
      : source === "auto_seed"
        ? ""
        : source === "auto_create"
          ? ""
          : source === "initial_seed"
            ? "warning"
            : "";
  return html`<span class="pill pill--sm ${cls}">${source || "-"}</span>`;
}

export function renderAdminMcps(props: AdminMcpsProps) {
  const { mcps } = props;

  if (!mcps) {
    return html`
      <div class="card">
        <div class="card-body">
          <span class="muted">Loading MCP access data...</span>
        </div>
      </div>
    `;
  }

  const allGrants = mcps.flatMap((m) => m.grants);
  const activeGrants = allGrants.filter((g) => g.is_active).length;
  const revokedGrants = allGrants.filter((g) => !g.is_active).length;
  const uniqueUsers = props.users?.filter((u) => u.status === "active").length ?? 0;

  return html`
    <div class="page-title">MCP Access</div>
    <div class="page-sub">Manage user access to MCP integrations. Grant or revoke access per user per MCP.</div>

    ${renderSetupWizardSection(props)}

    ${renderGroupsSection(props)}

    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${uniqueUsers}</div>
          <div class="muted" style="font-size: 0.8rem;">Users</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${mcps.length}</div>
          <div class="muted" style="font-size: 0.8rem;">MCPs</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600;">${activeGrants}</div>
          <div class="muted" style="font-size: 0.8rem;">Active Grants</div>
        </div>
      </div>
      <div class="card card-compact" style="flex: 1;">
        <div class="card-body" style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 600; ${revokedGrants > 0 ? "color: var(--danger, #ef4444);" : ""}">${revokedGrants}</div>
          <div class="muted" style="font-size: 0.8rem;">Revoked</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 16px;">
      <div class="card-body" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span class="muted" style="font-size: 0.82rem; font-weight: 600;">Bulk Actions</span>
        <select
          id="bulk-mcp-select"
          style="padding: 5px 8px; border: 1px solid var(--border, rgba(255,255,255,0.12)); border-radius: 4px; background: var(--bg, #1a1e24); color: var(--fg, #e0e0e0); font-size: 0.82rem;"
        >
          <option value="">Select MCP...</option>
          ${ALL_MCPS.filter((m) => !DEDICATED_ACCESS_MCPS.has(m.name)).map(
            (m) => html`<option value=${m.name}>${m.label}</option>`,
          )}
        </select>
        <button
          class="btn btn--sm"
          style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
          ?disabled=${props.loading}
          @click=${(e: Event) => {
            const sel = (e.target as HTMLElement).parentElement!.querySelector<HTMLSelectElement>(
              "#bulk-mcp-select",
            );
            if (sel?.value) {
              props.onGrantAll(sel.value);
            }
          }}
        >Grant All Users</button>
        <button
          class="btn btn--sm"
          style="color: var(--danger, #ef4444); border-color: var(--danger, #ef4444);"
          ?disabled=${props.loading}
          @click=${(e: Event) => {
            const sel = (e.target as HTMLElement).parentElement!.querySelector<HTMLSelectElement>(
              "#bulk-mcp-select",
            );
            if (sel?.value) {
              props.onRevokeAll(sel.value);
            }
          }}
        >Revoke All Users</button>
        <div style="margin-left: auto;">
          <button
            class="btn btn--sm"
            style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
            ?disabled=${props.loading}
            @click=${() => props.onSeed()}
          >${props.loading ? "Seeding..." : "Seed All Users"}</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; font-size: 0.85rem;">
          <thead>
            <tr>
              <th style="width: 24px;"></th>
              <th style="width: 36px; text-align: right;" class="muted">#</th>
              ${renderSortHeader(props, "email", "Email")}
              ${renderSortHeader(props, "name", "Name")}
              ${renderSortHeader(props, "granted", "Granted", "right")}
              ${renderSortHeader(props, "connected", "Connected", "right")}
              <th style="text-align: right;">Total MCPs</th>
            </tr>
          </thead>
          <tbody>
            ${sortUserRows(buildUserRows(mcps, props.users, props.userConnections), props.sortColumn, props.sortDir).map((row, idx) => renderUserRow(props, row, idx + 1))}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

type UserRowData = {
  userId: string;
  email: string;
  displayName: string | null;
  mcpRows: AdminUserMcpRow[];
  grantedCount: number;
  connectedCount: number;
};

function buildUserRows(
  mcps: AdminMcpUserAccessSummary[],
  users: AdminUser[] | null,
  userConnections: Record<string, string[]> | null,
): UserRowData[] {
  // Build a map of userId -> grants across all MCPs
  const userMap = new Map<
    string,
    { email: string; displayName: string | null; grants: Map<string, AdminMcpUserAccessGrant> }
  >();

  for (const mcp of mcps) {
    for (const grant of mcp.grants) {
      let entry = userMap.get(grant.user_id);
      if (!entry) {
        entry = { email: grant.email, displayName: grant.display_name, grants: new Map() };
        userMap.set(grant.user_id, entry);
      }
      entry.grants.set(grant.mcp_name, grant);
    }
  }

  // Also include users that have no grants at all
  if (users) {
    for (const user of users) {
      if (user.status === "active" && !userMap.has(user.id)) {
        userMap.set(user.id, {
          email: user.email,
          displayName: user.full_name,
          grants: new Map(),
        });
      }
    }
  }

  // Build display name map from MCPs
  const mcpDisplayNames = new Map<string, string>();
  for (const mcp of mcps) {
    mcpDisplayNames.set(mcp.mcp_name, mcp.display_name);
  }

  // Build rows
  const rows: UserRowData[] = [];
  for (const [userId, entry] of userMap) {
    const connectedMcps = userConnections?.[userId];
    const mcpRows: AdminUserMcpRow[] = ALL_MCPS.map((mcp) => {
      const grant = entry.grants.get(mcp.name);
      return {
        mcp_name: mcp.name,
        display_name: mcpDisplayNames.get(mcp.name) ?? mcp.label,
        is_active: grant?.is_active ?? false,
        is_connected: grant?.is_connected ?? connectedMcps?.includes(mcp.name) ?? false,
        grant_source: grant?.grant_source ?? null,
        created_at: grant?.created_at ?? null,
        revoked_at: grant?.revoked_at ?? null,
      };
    });

    const managedRows = mcpRows.filter((r) => !DEDICATED_ACCESS_MCPS.has(r.mcp_name));
    rows.push({
      userId,
      email: entry.email,
      displayName: entry.displayName,
      mcpRows,
      grantedCount: managedRows.filter((r) => r.is_active).length,
      connectedCount: mcpRows.filter((r) => r.is_connected).length,
    });
  }

  return rows;
}

function sortUserRows(rows: UserRowData[], column: McpSortColumn, dir: McpSortDir): UserRowData[] {
  const mult = dir === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    switch (column) {
      case "email":
        return mult * a.email.localeCompare(b.email);
      case "name":
        return mult * (a.displayName ?? "").localeCompare(b.displayName ?? "");
      case "granted":
        return mult * (a.grantedCount - b.grantedCount);
      case "connected":
        return mult * (a.connectedCount - b.connectedCount);
      default:
        return 0;
    }
  });
}

function renderSortHeader(
  props: AdminMcpsProps,
  column: McpSortColumn,
  label: string,
  align?: "right",
) {
  const isActive = props.sortColumn === column;
  const arrow = isActive ? (props.sortDir === "asc" ? " \u25B2" : " \u25BC") : "";
  return html`
    <th
      style="cursor: pointer; user-select: none;${align ? " text-align: right;" : ""}"
      @click=${() => props.onSort(column)}
    >${label}${isActive ? html`<span style="font-size: 0.65rem; margin-left: 3px; opacity: 0.7;">${arrow}</span>` : nothing}</th>
  `;
}

function renderUserRow(props: AdminMcpsProps, row: UserRowData, rowNum: number) {
  const isExpanded = props.expandedUserId === row.userId;

  return html`
    <tr
      style="cursor: pointer;"
      @click=${() => props.onToggleUser(row.userId)}
    >
      <td style="width: 24px; text-align: center; font-size: 0.7rem;">${isExpanded ? "\u25BC" : "\u25B6"}</td>
      <td style="width: 36px; text-align: right; font-size: 0.75rem;" class="muted">${rowNum}</td>
      <td class="mono" style="max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${row.email}"><strong>${row.email}</strong></td>
      <td>${row.displayName ?? "-"}</td>
      <td style="text-align: right;">
        <span class="pill pill--sm${row.grantedCount > 0 ? " success" : ""}">${row.grantedCount}</span>
      </td>
      <td style="text-align: right;">
        <span class="pill pill--sm${row.connectedCount > 0 ? " success" : ""}">${row.connectedCount}</span>
      </td>
      <td style="text-align: right;" class="muted">${ALL_MCPS.length - DEDICATED_ACCESS_MCPS.size}</td>
    </tr>
    ${isExpanded ? renderUserExpanded(props, row) : nothing}
  `;
}

function renderUserExpanded(props: AdminMcpsProps, row: UserRowData) {
  const managedRows = row.mcpRows.filter((r) => !DEDICATED_ACCESS_MCPS.has(r.mcp_name));
  const dedicatedRows = row.mcpRows.filter((r) => DEDICATED_ACCESS_MCPS.has(r.mcp_name));

  return html`
    <tr>
      <td colspan="7" style="padding: 0;">
        <div style="padding: 8px 8px 8px 32px; background: var(--bg-subtle, rgba(255,255,255,0.03));">
          <table class="data-table" style="width: 100%; font-size: 0.82rem;">
            <thead>
              <tr>
                <th>MCP</th>
                <th>Display Name</th>
                <th>Access</th>
                <th>Connected</th>
                <th>Source</th>
                <th>Granted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${managedRows.map((mcpRow) => renderUserMcpRow(props, row.userId, mcpRow))}
              ${
                dedicatedRows.length > 0
                  ? html`
                <tr>
                  <td colspan="7" style="padding: 6px 0 4px 0; border: none;">
                    <div class="muted" style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Company-Token MCPs (managed via dedicated pages)</div>
                  </td>
                </tr>
                ${dedicatedRows.map((mcpRow) => renderDedicatedMcpRow(mcpRow))}
              `
                  : nothing
              }
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  `;
}

function renderDedicatedMcpRow(mcpRow: AdminUserMcpRow) {
  return html`
    <tr style="opacity: 0.7;">
      <td class="mono"><strong>${mcpRow.mcp_name}</strong></td>
      <td>${mcpRow.display_name}</td>
      <td><span class="pill pill--sm" style="opacity: 0.5;">Managed separately</span></td>
      <td>${
        mcpRow.is_connected
          ? html`
              <span class="pill pill--sm success">Connected</span>
            `
          : html`
              <span class="pill pill--sm" style="opacity: 0.4">-</span>
            `
      }</td>
      <td class="muted">-</td>
      <td class="muted">-</td>
      <td>
        <span class="muted" style="font-size: 0.78rem; cursor: default;" title="Manage access via the /${mcpRow.mcp_name} admin tab">\u2192 /${mcpRow.mcp_name}</span>
      </td>
    </tr>
  `;
}

function renderUserMcpRow(props: AdminMcpsProps, userId: string, mcpRow: AdminUserMcpRow) {
  const hasGrant = mcpRow.grant_source !== null;
  return html`
    <tr style="${hasGrant && !mcpRow.is_active ? "opacity: 0.5;" : ""}">
      <td class="mono"><strong>${mcpRow.mcp_name}</strong></td>
      <td>${mcpRow.display_name}</td>
      <td>${
        !hasGrant
          ? html`
              <span class="pill pill--sm" style="opacity: 0.4">No Grant</span>
            `
          : mcpRow.is_active
            ? html`
                <span class="pill pill--sm success">Active</span>
              `
            : html`
                <span class="pill pill--sm danger">Revoked</span>
              `
      }</td>
      <td>${
        mcpRow.is_connected
          ? html`
              <span class="pill pill--sm success">Connected</span>
            `
          : html`
              <span class="pill pill--sm" style="opacity: 0.4">-</span>
            `
      }</td>
      <td>${
        mcpRow.grant_source
          ? grantSourcePill(mcpRow.grant_source)
          : html`
              <span class="muted">-</span>
            `
      }</td>
      <td class="mono">${formatDate(mcpRow.created_at)}</td>
      <td>
        ${
          mcpRow.is_active
            ? html`<button
                class="btn btn--sm"
                style="color: var(--danger, #ef4444); border-color: var(--danger, #ef4444);"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  props.onRevoke(userId, mcpRow.mcp_name);
                }}
              >Revoke</button>`
            : html`<button
                class="btn btn--sm"
                style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  props.onGrant(userId, mcpRow.mcp_name);
                }}
              >Grant</button>`
        }
      </td>
    </tr>
  `;
}

function renderSetupWizardSection(props: AdminMcpsProps) {
  const { mcpSetupConfig } = props;
  if (!mcpSetupConfig) {
    return nothing;
  }

  const enabledCount = mcpSetupConfig.filter((m) => m.enabled_in_setup).length;

  return html`
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-body">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <div style="font-weight: 600; font-size: 0.95rem;">Setup Wizard Availability</div>
            <div class="muted" style="font-size: 0.8rem;">Control which MCPs new users can select during <code style="font-size: 0.75rem; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px;">npx @danainnovations/cortex-mcp setup</code></div>
          </div>
          <div class="muted" style="font-size: 0.8rem;">${enabledCount} of ${mcpSetupConfig.length} enabled</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">
          ${mcpSetupConfig.map(
            (item) => html`
              <div
                style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  padding: 8px 12px;
                  border: 1px solid ${item.enabled_in_setup ? "var(--accent, #3b82f6)" : "var(--border, rgba(255,255,255,0.08))"};
                  border-radius: 6px;
                  background: ${item.enabled_in_setup ? "rgba(59, 130, 246, 0.06)" : "transparent"};
                  cursor: pointer;
                  transition: all 0.15s ease;
                "
                @click=${() => props.onToggleSetup(item.mcp_name, !item.enabled_in_setup)}
              >
                <span style="font-size: 0.85rem; font-weight: 500;">${item.display_name}</span>
                <div style="
                  width: 36px;
                  height: 20px;
                  border-radius: 10px;
                  background: ${item.enabled_in_setup ? "var(--accent, #3b82f6)" : "rgba(255,255,255,0.15)"};
                  position: relative;
                  transition: background 0.15s ease;
                ">
                  <div style="
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #fff;
                    position: absolute;
                    top: 2px;
                    left: ${item.enabled_in_setup ? "18px" : "2px"};
                    transition: left 0.15s ease;
                  "></div>
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    </div>
  `;
}

/** MCPs that bypass Layer 3 (per-user grants) and use dedicated resource-level access pages instead */
const DEDICATED_ACCESS_MCPS = new Set(["github", "vercel", "supabase", "databricks"]);

const ALL_MCPS: Array<{ name: string; label: string }> = [
  { name: "asana", label: "Asana" },
  { name: "bestbuy", label: "Best Buy" },
  { name: "concur", label: "SAP Concur" },
  { name: "databricks", label: "Databricks" },
  { name: "github", label: "GitHub" },
  { name: "m365", label: "Microsoft 365" },
  { name: "mailchimp", label: "Mailchimp" },
  { name: "monday", label: "Monday.com" },
  { name: "powerbi", label: "Power BI" },
  { name: "salesforce", label: "Salesforce" },
  { name: "slack", label: "Slack" },
  { name: "supabase", label: "Supabase" },
  { name: "vercel", label: "Vercel" },
];

function renderGroupsSection(props: AdminMcpsProps) {
  const { groups } = props;

  return html`
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-body">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <div style="font-weight: 600; font-size: 0.95rem;">Groups</div>
            <div class="muted" style="font-size: 0.8rem;">Create groups, assign users and MCPs. Members inherit group MCP access.</div>
          </div>
          <button
            class="btn btn--sm"
            style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
            @click=${() => props.onShowCreateGroup()}
          >+ Create Group</button>
        </div>

        ${props.groupCreating ? renderCreateGroupForm(props) : nothing}

        ${
          !groups || groups.length === 0
            ? html`
                <p class="muted" style="font-size: 0.82rem; margin: 8px 0 0 0">
                  No groups yet. Create one to get started.
                </p>
              `
            : html`
            <table class="data-table" style="width: 100%; font-size: 0.85rem;">
              <thead>
                <tr>
                  <th style="width: 24px;"></th>
                  <th>Group</th>
                  <th>Description</th>
                  <th style="text-align: right;">Members</th>
                  <th style="text-align: right;">MCPs</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${groups.map((group) => renderGroupRow(props, group))}
              </tbody>
            </table>
          `
        }
      </div>
    </div>
  `;
}

function renderCreateGroupForm(props: AdminMcpsProps) {
  return html`
    <div style="display: flex; gap: 8px; align-items: flex-end; margin-bottom: 12px; padding: 12px; border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 6px; background: var(--bg-subtle, rgba(255,255,255,0.03));">
      <div style="flex: 1;">
        <label style="font-size: 0.75rem; color: var(--muted); display: block; margin-bottom: 2px;">Name</label>
        <input
          type="text"
          id="group-name-input"
          placeholder="e.g. Admins"
          style="width: 100%; padding: 6px 8px; border: 1px solid var(--border, rgba(255,255,255,0.12)); border-radius: 4px; background: var(--bg, #1a1e24); color: var(--fg, #e0e0e0); font-size: 0.85rem;"
        />
      </div>
      <div style="flex: 2;">
        <label style="font-size: 0.75rem; color: var(--muted); display: block; margin-bottom: 2px;">Description (optional)</label>
        <input
          type="text"
          id="group-desc-input"
          placeholder="e.g. Admin team with full access"
          style="width: 100%; padding: 6px 8px; border: 1px solid var(--border, rgba(255,255,255,0.12)); border-radius: 4px; background: var(--bg, #1a1e24); color: var(--fg, #e0e0e0); font-size: 0.85rem;"
        />
      </div>
      <button
        class="btn btn--sm"
        style="background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);"
        @click=${(e: Event) => {
          const container = (e.target as HTMLElement).closest("div")!.parentElement!;
          const nameEl = container.querySelector<HTMLInputElement>("#group-name-input");
          const descEl = container.querySelector<HTMLInputElement>("#group-desc-input");
          const name = nameEl?.value.trim() ?? "";
          const desc = descEl?.value.trim() ?? "";
          if (name) {
            props.onCreateGroup(name, desc);
          }
        }}
      >Create</button>
      <button
        class="btn btn--sm"
        @click=${() => props.onShowCreateGroup()}
      >Cancel</button>
    </div>
  `;
}

function renderGroupRow(props: AdminMcpsProps, group: McpGroup) {
  const isExpanded = props.expandedGroupId === group.id;

  return html`
    <tr style="cursor: pointer;" @click=${() => props.onToggleGroup(group.id)}>
      <td style="width: 24px; text-align: center; font-size: 0.7rem;">${isExpanded ? "\u25BC" : "\u25B6"}</td>
      <td><strong>${group.name}</strong></td>
      <td class="muted">${group.description || "-"}</td>
      <td style="text-align: right;"><span class="pill pill--sm">${group.member_count}</span></td>
      <td style="text-align: right;"><span class="pill pill--sm">${group.mcp_grants.length}</span></td>
      <td style="text-align: right;">
        <button
          class="btn btn--sm"
          style="color: var(--danger, #ef4444); border-color: var(--danger, #ef4444); font-size: 0.75rem;"
          @click=${(e: Event) => {
            e.stopPropagation();
            props.onDeleteGroup(group.id);
          }}
        >Delete</button>
      </td>
    </tr>
    ${isExpanded ? renderGroupExpanded(props, group) : nothing}
  `;
}

function renderGroupExpanded(props: AdminMcpsProps, group: McpGroup) {
  // Get users not already in this group for the "Add" dropdown
  const memberIds = new Set(group.members.map((m) => m.user_id));
  const availableUsers = (props.users || []).filter(
    (u) => u.status === "active" && !memberIds.has(u.id),
  );

  return html`
    <tr>
      <td colspan="7" style="padding: 0;">
        <div style="padding: 12px 12px 12px 32px; background: var(--bg-subtle, rgba(255,255,255,0.03));">
          <!-- MCP Access toggles -->
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px;">MCP Access</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px;">
              ${ALL_MCPS.map((mcp) => {
                const granted = group.mcp_grants.includes(mcp.name);
                return html`
                  <div
                    style="
                      display: flex; align-items: center; justify-content: space-between;
                      padding: 6px 10px;
                      border: 1px solid ${granted ? "var(--accent, #3b82f6)" : "var(--border, rgba(255,255,255,0.08))"};
                      border-radius: 5px;
                      background: ${granted ? "rgba(59, 130, 246, 0.06)" : "transparent"};
                      cursor: pointer; transition: all 0.15s ease;
                      font-size: 0.82rem;
                    "
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      if (granted) {
                        props.onRevokeGroupAccess(group.id, mcp.name);
                      } else {
                        props.onGrantGroupAccess(group.id, mcp.name);
                      }
                    }}
                  >
                    <span style="font-weight: 500;">${mcp.label}</span>
                    <div style="
                      width: 32px; height: 18px; border-radius: 9px;
                      background: ${granted ? "var(--accent, #3b82f6)" : "rgba(255,255,255,0.15)"};
                      position: relative; transition: background 0.15s ease;
                    ">
                      <div style="
                        width: 14px; height: 14px; border-radius: 50%; background: #fff;
                        position: absolute; top: 2px;
                        left: ${granted ? "16px" : "2px"};
                        transition: left 0.15s ease;
                      "></div>
                    </div>
                  </div>
                `;
              })}
            </div>
          </div>

          <!-- Members -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="font-weight: 600; font-size: 0.85rem;">Members (${group.members.length})</div>
              ${
                availableUsers.length > 0
                  ? html`
                  <select
                    style="padding: 4px 8px; border: 1px solid var(--border, rgba(255,255,255,0.12)); border-radius: 4px; background: var(--bg, #1a1e24); color: var(--fg, #e0e0e0); font-size: 0.8rem;"
                    @change=${(e: Event) => {
                      const sel = e.target as HTMLSelectElement;
                      if (sel.value) {
                        props.onAddGroupMembers(group.id, [sel.value]);
                        sel.value = "";
                      }
                    }}
                  >
                    <option value="">+ Add member...</option>
                    ${availableUsers.map((u) => html`<option value=${u.id}>${u.email}</option>`)}
                  </select>
                `
                  : nothing
              }
            </div>
            ${
              group.members.length > 0
                ? html`
                <table class="data-table" style="width: 100%; font-size: 0.82rem;">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Added</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${group.members
                      .slice()
                      .toSorted((a, b) => a.email.localeCompare(b.email))
                      .map(
                        (m) => html`
                          <tr>
                            <td class="mono" style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${m.email}">${m.email}</td>
                            <td>${m.display_name ?? "-"}</td>
                            <td class="mono">${formatDate(m.added_at)}</td>
                            <td>
                              <button
                                class="btn btn--sm"
                                style="color: var(--danger, #ef4444); border-color: var(--danger, #ef4444); font-size: 0.75rem;"
                                @click=${(e: Event) => {
                                  e.stopPropagation();
                                  props.onRemoveGroupMember(group.id, m.user_id);
                                }}
                              >Remove</button>
                            </td>
                          </tr>
                        `,
                      )}
                  </tbody>
                </table>
              `
                : html`
                    <p class="muted" style="font-size: 0.82rem; margin: 4px 0">
                      No members yet. Add users using the dropdown above.
                    </p>
                  `
            }
          </div>
        </div>
      </td>
    </tr>
  `;
}
