/**
 * Admin Controller
 *
 * Fetches admin data (users, usage, MCP access) via gateway methods
 * registered by the sonance-cortex plugin.
 */

import type {
  AdminActivityFilters,
  AdminActivityFilterOptions,
  AdminActivityLogResponse,
  AdminMcpAccessEntry,
  AdminMcpInfo,
  AdminProjectSummary,
  AdminUsageDetail,
  AdminUsageSummary,
  AdminUser,
} from "../types-admin.ts";
import {
  loadActivityLog,
  loadActivityLogFilterOptions,
  type AdminActivityLogHost,
} from "./admin-activity-log.ts";

export type AdminState = {
  adminLoading: boolean;
  adminError: string | null;
  adminPanel: "users" | "usage" | "mcp" | "activity" | "projects";
  adminUsers: AdminUser[] | null;
  adminUsersFilter: string;
  adminUsageSummary: AdminUsageSummary | null;
  adminUsageDetails: AdminUsageDetail[] | null;
  adminMcps: AdminMcpInfo[] | null;
  adminMcpAccess: AdminMcpAccessEntry[] | null;
  adminProjects: AdminProjectSummary[] | null;
  adminActivityLog: AdminActivityLogResponse | null;
  adminActivityLogLoading: boolean;
  adminActivityFilters: AdminActivityFilters;
  adminActivityFilterOptions: AdminActivityFilterOptions | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  client: {
    request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  } | null;
};

export async function loadAdminUsers(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    const result = (await state.client.request("sonance.admin.users")) as {
      users: AdminUser[];
    };
    state.adminUsers = result.users;
  } catch (err) {
    state.adminError = `Failed to load users: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

export async function loadAdminUsage(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    const result = (await state.client.request("sonance.admin.usage", { limit: 100 })) as {
      summary: AdminUsageSummary;
      details: AdminUsageDetail[];
    };
    state.adminUsageSummary = result.summary;
    state.adminUsageDetails = result.details;
  } catch (err) {
    state.adminError = `Failed to load usage data: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

export async function loadAdminMcpAccess(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    const result = (await state.client.request("sonance.admin.mcp_access")) as {
      mcps: AdminMcpInfo[];
      userAccess: AdminMcpAccessEntry[];
    };
    state.adminMcps = result.mcps;
    state.adminMcpAccess = result.userAccess;
  } catch (err) {
    state.adminError = `Failed to load MCP access data: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

export async function loadAdminProjectAccess(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    const result = (await state.client.request("sonance.admin.project_access")) as {
      projects: AdminProjectSummary[];
      total_grants: number;
    };
    state.adminProjects = result.projects;
  } catch (err) {
    state.adminError = `Failed to load project access: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

export async function grantProjectAccess(
  state: AdminState,
  userId: string,
  projectRef: string,
  projectName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_project_access", {
      user_id: userId,
      project_ref: projectRef,
      project_name: projectName,
    });
    await loadAdminProjectAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant access: ${String(err)}`;
  }
}

export async function revokeProjectAccess(
  state: AdminState,
  userId: string,
  projectRef: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_project_access", {
      user_id: userId,
      project_ref: projectRef,
    });
    await loadAdminProjectAccess(state);
  } catch (err) {
    state.adminError = `Failed to revoke access: ${String(err)}`;
  }
}

export async function revokeAllProjectAccess(state: AdminState, userId: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_all_project_access", {
      user_id: userId,
    });
    await loadAdminProjectAccess(state);
  } catch (err) {
    state.adminError = `Failed to revoke all access: ${String(err)}`;
  }
}

export async function grantAllProjectAccess(state: AdminState, userId: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_all_project_access", {
      user_id: userId,
    });
    await loadAdminProjectAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant all access: ${String(err)}`;
  }
}

export async function loadAdminData(state: AdminState): Promise<void> {
  switch (state.adminPanel) {
    case "users":
      return loadAdminUsers(state);
    case "usage":
      return loadAdminUsage(state);
    case "mcp":
      return loadAdminMcpAccess(state);
    case "projects":
      void loadAdminUsers(state);
      return loadAdminProjectAccess(state);
    case "activity": {
      const host = state as unknown as AdminActivityLogHost;
      void loadActivityLogFilterOptions(host);
      return loadActivityLog(host);
    }
  }
}
