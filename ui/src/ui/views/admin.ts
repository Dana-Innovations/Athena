/**
 * Admin View
 *
 * Main admin tab with sub-panel navigation (Users / Usage / MCP).
 * Gated to users with admin role in the cortex_users table.
 */

import { html, nothing } from "lit";
import type {
  AdminActivityFilters,
  AdminActivityFilterOptions,
  AdminActivityLogResponse,
  AdminMcpAccessEntry,
  AdminMcpInfo,
  AdminUsageDetail,
  AdminUsageSummary,
  AdminUser,
} from "../types-admin.ts";
import { renderAdminActivityLog } from "./admin-activity-log.ts";
import { renderAdminMcp } from "./admin-mcp.ts";
import { renderAdminUsage } from "./admin-usage.ts";
import { renderAdminUsers } from "./admin-users.ts";

export type AdminPanelId = "users" | "usage" | "mcp" | "activity";

export type AdminViewProps = {
  loading: boolean;
  error: string | null;
  activePanel: AdminPanelId;
  users: AdminUser[] | null;
  usersFilter: string;
  usageSummary: AdminUsageSummary | null;
  usageDetails: AdminUsageDetail[] | null;
  mcps: AdminMcpInfo[] | null;
  mcpAccess: AdminMcpAccessEntry[] | null;
  onMcpGrant: (userId: string, mcpName: string) => void;
  onMcpRevoke: (userId: string, mcpName: string) => void;
  onMcpSeed: () => void;
  activityLog: AdminActivityLogResponse | null;
  activityLogLoading: boolean;
  activityFilters: AdminActivityFilters;
  activityFilterOptions: AdminActivityFilterOptions | null;
  activityExpandedId: string | null;
  onPanelChange: (panel: AdminPanelId) => void;
  onUsersFilterChange: (filter: string) => void;
  onActivityFilterChange: (key: keyof AdminActivityFilters, value: string | null) => void;
  onActivityPageChange: (page: number) => void;
  onActivityToggleExpand: (id: string) => void;
  onRefresh: () => void;
};

const PANELS = [
  { id: "users" as const, label: "Users" },
  { id: "usage" as const, label: "Usage" },
  { id: "mcp" as const, label: "MCP" },
  { id: "activity" as const, label: "Activity" },
];

export function renderAdmin(props: AdminViewProps) {
  return html`
    <div class="page-title">Admin</div>
    <div class="page-sub">User management, usage analytics, and MCP configuration.</div>

    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
      ${PANELS.map(
        (p) => html`
          <button
            class="btn btn--sm"
            style="${props.activePanel === p.id ? "background: var(--accent, #3b82f6); color: var(--accent-fg, #fff); border-color: var(--accent, #3b82f6);" : ""}"
            @click=${() => props.onPanelChange(p.id)}
          >${p.label}</button>
        `,
      )}
      <button
        class="btn btn--sm"
        ?disabled=${props.loading}
        @click=${() => props.onRefresh()}
        style="margin-left: auto;"
      >${props.loading ? "Loading..." : "Refresh"}</button>
    </div>

    ${
      props.error
        ? html`<div class="pill danger" style="margin-bottom: 16px;">${props.error}</div>`
        : nothing
    }

    ${
      props.activePanel === "users"
        ? renderAdminUsers({
            users: props.users,
            filter: props.usersFilter,
            onFilterChange: props.onUsersFilterChange,
          })
        : nothing
    }

    ${
      props.activePanel === "usage"
        ? renderAdminUsage({
            summary: props.usageSummary,
            details: props.usageDetails,
          })
        : nothing
    }

    ${
      props.activePanel === "mcp"
        ? renderAdminMcp({
            mcps: props.mcps,
            mcpAccess: props.mcpAccess,
            mcpUserAccess: null,
            onGrant: props.onMcpGrant,
            onRevoke: props.onMcpRevoke,
            onSeed: props.onMcpSeed,
            loading: props.loading,
          })
        : nothing
    }

    ${
      props.activePanel === "activity"
        ? renderAdminActivityLog({
            log: props.activityLog,
            loading: props.activityLogLoading,
            filters: props.activityFilters,
            filterOptions: props.activityFilterOptions,
            expandedId: props.activityExpandedId,
            onFilterChange: props.onActivityFilterChange,
            onPageChange: props.onActivityPageChange,
            onToggleExpand: props.onActivityToggleExpand,
            onRefresh: props.onRefresh,
          })
        : nothing
    }
  `;
}
