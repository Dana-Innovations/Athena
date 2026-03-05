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
  adminPanel: "users" | "usage" | "mcp" | "activity";
  adminUsers: AdminUser[] | null;
  adminUsersFilter: string;
  adminUsageSummary: AdminUsageSummary | null;
  adminUsageDetails: AdminUsageDetail[] | null;
  adminMcps: AdminMcpInfo[] | null;
  adminMcpAccess: AdminMcpAccessEntry[] | null;
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

export async function loadAdminData(state: AdminState): Promise<void> {
  switch (state.adminPanel) {
    case "users":
      return loadAdminUsers(state);
    case "usage":
      return loadAdminUsage(state);
    case "mcp":
      return loadAdminMcpAccess(state);
    case "activity": {
      const host = state as unknown as AdminActivityLogHost;
      void loadActivityLogFilterOptions(host);
      return loadActivityLog(host);
    }
  }
}
