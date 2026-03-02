/**
 * Admin View
 *
 * Main admin tab with sub-panel navigation (Users / Usage / MCP).
 * Gated to users with admin role in the cortex_users table.
 */

import { html, nothing } from "lit";
import type {
  AdminMcpAccessEntry,
  AdminMcpInfo,
  AdminUsageDetail,
  AdminUsageSummary,
  AdminUser,
} from "../types-admin.ts";
import { renderAdminMcp } from "./admin-mcp.ts";
import { renderAdminUsage } from "./admin-usage.ts";
import { renderAdminUsers } from "./admin-users.ts";

export type AdminViewProps = {
  loading: boolean;
  error: string | null;
  activePanel: "users" | "usage" | "mcp";
  users: AdminUser[] | null;
  usersFilter: string;
  usageSummary: AdminUsageSummary | null;
  usageDetails: AdminUsageDetail[] | null;
  mcps: AdminMcpInfo[] | null;
  mcpAccess: AdminMcpAccessEntry[] | null;
  onPanelChange: (panel: "users" | "usage" | "mcp") => void;
  onUsersFilterChange: (filter: string) => void;
  onRefresh: () => void;
};

const PANELS = [
  { id: "users" as const, label: "Users" },
  { id: "usage" as const, label: "Usage" },
  { id: "mcp" as const, label: "MCP" },
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
          })
        : nothing
    }
  `;
}
