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
  AdminDatabricksCatalogSummary,
  AdminGitHubRepoSummary,
  AdminMcpAccessEntry,
  AdminMcpInfo,
  AdminMcpUserAccessSummary,
  AdminProjectSummary,
  AdminUsageDetail,
  AdminUsageSummary,
  AdminUser,
  AdminVercelProjectSummary,
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
  adminProjects: AdminProjectSummary[] | null;
  adminGitHubRepos: AdminGitHubRepoSummary[] | null;
  adminVercelProjects: AdminVercelProjectSummary[] | null;
  adminDatabricksCatalogs: AdminDatabricksCatalogSummary[] | null;
  adminMcpUserAccess: AdminMcpUserAccessSummary[] | null;
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
    // Optimistic update instead of full reload
    if (state.adminProjects) {
      for (const project of state.adminProjects) {
        for (const grant of project.grants) {
          if (grant.user_id === userId && grant.project_ref === projectRef) {
            grant.is_active = false;
          }
        }
      }
    }
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
    // Optimistic update instead of full reload
    if (state.adminProjects) {
      for (const project of state.adminProjects) {
        for (const grant of project.grants) {
          if (grant.user_id === userId) {
            grant.is_active = false;
          }
        }
      }
    }
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

// ── GitHub Repo Access ──────────────────────────────────────────────

export async function loadAdminGitHubRepoAccess(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    const result = (await state.client.request("sonance.admin.github_repo_access")) as {
      repos: AdminGitHubRepoSummary[];
      total_grants: number;
    };
    state.adminGitHubRepos = result.repos;
  } catch (err) {
    state.adminError = `Failed to load GitHub repo access: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

export async function grantGitHubRepoAccess(
  state: AdminState,
  userId: string,
  repoFullName: string,
  repoName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_github_repo_access", {
      user_id: userId,
      repo_full_name: repoFullName,
      repo_name: repoName,
    });
    await loadAdminGitHubRepoAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant GitHub repo access: ${String(err)}`;
  }
}

export async function revokeGitHubRepoAccess(
  state: AdminState,
  userId: string,
  repoFullName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_github_repo_access", {
      user_id: userId,
      repo_full_name: repoFullName,
    });
    // Optimistic update instead of full reload
    if (state.adminGitHubRepos) {
      for (const repo of state.adminGitHubRepos) {
        for (const grant of repo.grants) {
          if (grant.user_id === userId && grant.repo_full_name === repoFullName) {
            grant.is_active = false;
          }
        }
      }
    }
  } catch (err) {
    state.adminError = `Failed to revoke GitHub repo access: ${String(err)}`;
  }
}

export async function revokeAllGitHubRepoAccess(state: AdminState, userId: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_all_github_repo_access", {
      user_id: userId,
    });
    // Optimistic update instead of full reload
    if (state.adminGitHubRepos) {
      for (const repo of state.adminGitHubRepos) {
        for (const grant of repo.grants) {
          if (grant.user_id === userId) {
            grant.is_active = false;
          }
        }
      }
    }
  } catch (err) {
    state.adminError = `Failed to revoke all GitHub repo access: ${String(err)}`;
  }
}

export async function grantAllGitHubRepoAccess(state: AdminState, userId: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_all_github_repo_access", {
      user_id: userId,
    });
    await loadAdminGitHubRepoAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant all GitHub repo access: ${String(err)}`;
  }
}

// ── Vercel Project Access ───────────────────────────────────────────

export async function loadAdminVercelProjectAccess(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    const result = (await state.client.request("sonance.admin.vercel_project_access")) as {
      projects: AdminVercelProjectSummary[];
      total_grants: number;
    };
    state.adminVercelProjects = result.projects;
  } catch (err) {
    state.adminError = `Failed to load Vercel project access: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

export async function grantVercelProjectAccess(
  state: AdminState,
  userId: string,
  projectId: string,
  projectName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_vercel_project_access", {
      user_id: userId,
      project_id: projectId,
      project_name: projectName,
    });
    await loadAdminVercelProjectAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant Vercel project access: ${String(err)}`;
  }
}

export async function revokeVercelProjectAccess(
  state: AdminState,
  userId: string,
  projectId: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_vercel_project_access", {
      user_id: userId,
      project_id: projectId,
    });
    // Optimistic update instead of full reload
    if (state.adminVercelProjects) {
      for (const project of state.adminVercelProjects) {
        for (const grant of project.grants) {
          if (grant.user_id === userId && grant.project_id === projectId) {
            grant.is_active = false;
          }
        }
      }
    }
  } catch (err) {
    state.adminError = `Failed to revoke Vercel project access: ${String(err)}`;
  }
}

export async function revokeAllVercelProjectAccess(
  state: AdminState,
  userId: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_all_vercel_project_access", {
      user_id: userId,
    });
    // Optimistic update instead of full reload
    if (state.adminVercelProjects) {
      for (const project of state.adminVercelProjects) {
        for (const grant of project.grants) {
          if (grant.user_id === userId) {
            grant.is_active = false;
          }
        }
      }
    }
  } catch (err) {
    state.adminError = `Failed to revoke all Vercel project access: ${String(err)}`;
  }
}

export async function grantAllVercelProjectAccess(
  state: AdminState,
  userId: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_all_vercel_project_access", {
      user_id: userId,
    });
    await loadAdminVercelProjectAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant all Vercel project access: ${String(err)}`;
  }
}

// ── Databricks Catalog Access ────────────────────────────────────────

export async function loadAdminDatabricksAccess(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    const result = (await state.client.request("sonance.admin.databricks_access")) as {
      catalogs: AdminDatabricksCatalogSummary[];
      total_grants: number;
    };
    state.adminDatabricksCatalogs = result.catalogs;
  } catch (err) {
    state.adminError = `Failed to load Databricks catalog access: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

export async function grantDatabricksAccess(
  state: AdminState,
  userId: string,
  catalogName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_databricks_access", {
      user_id: userId,
      catalog_name: catalogName,
    });
    await loadAdminDatabricksAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant Databricks catalog access: ${String(err)}`;
  }
}

export async function revokeDatabricksAccess(
  state: AdminState,
  userId: string,
  catalogName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_databricks_access", {
      user_id: userId,
      catalog_name: catalogName,
    });
    await loadAdminDatabricksAccess(state);
  } catch (err) {
    state.adminError = `Failed to revoke Databricks catalog access: ${String(err)}`;
  }
}

// ── MCP User Access (MCP-level enable/disable) ──────────────────────

export async function loadMcpUserAccess(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    const result = (await state.client.request("sonance.admin.mcp_user_access")) as {
      mcps: AdminMcpUserAccessSummary[];
      total_grants: number;
    };
    state.adminMcpUserAccess = result.mcps;
  } catch (err) {
    state.adminError = `Failed to load MCP user access: ${String(err)}`;
  }
}

export async function grantMcpUserAccess(
  state: AdminState,
  userId: string,
  mcpName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_mcp_user_access", {
      user_id: userId,
      mcp_name: mcpName,
    });
    // Reload both the user access and the matrix
    await Promise.all([loadMcpUserAccess(state), loadAdminMcpAccess(state)]);
  } catch (err) {
    state.adminError = `Failed to grant MCP access: ${String(err)}`;
  }
}

export async function revokeMcpUserAccess(
  state: AdminState,
  userId: string,
  mcpName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_mcp_user_access", {
      user_id: userId,
      mcp_name: mcpName,
    });
    // Optimistic update
    if (state.adminMcpUserAccess) {
      for (const mcp of state.adminMcpUserAccess) {
        if (mcp.mcp_name === mcpName) {
          for (const grant of mcp.grants) {
            if (grant.user_id === userId) {
              grant.is_active = false;
            }
          }
        }
      }
    }
    // Also reload the matrix
    await loadAdminMcpAccess(state);
  } catch (err) {
    state.adminError = `Failed to revoke MCP access: ${String(err)}`;
  }
}

export async function grantAllMcpUserAccess(state: AdminState, mcpName: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.grant_all_mcp_user_access", {
      mcp_name: mcpName,
    });
    await loadMcpUserAccess(state);
  } catch (err) {
    state.adminError = `Failed to grant all MCP access: ${String(err)}`;
  }
}

export async function revokeAllMcpUserAccess(state: AdminState, mcpName: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.revoke_all_mcp_user_access", {
      mcp_name: mcpName,
    });
    await loadMcpUserAccess(state);
  } catch (err) {
    state.adminError = `Failed to revoke all MCP access: ${String(err)}`;
  }
}

export async function seedMcpUserAccess(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.adminLoading = true;
  state.adminError = null;
  try {
    await state.client.request("sonance.admin.seed_mcp_user_access");
    await Promise.all([loadMcpUserAccess(state), loadAdminMcpAccess(state)]);
  } catch (err) {
    state.adminError = `Failed to seed MCP user access: ${String(err)}`;
  } finally {
    state.adminLoading = false;
  }
}

// ---------------------------------------------------------------------------
// MCP Setup Wizard Config
// ---------------------------------------------------------------------------

export async function loadMcpSetupConfig(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    const result = await state.client.request("sonance.admin.mcp_setup_config");
    state.adminMcpSetupConfig = (result as Record<string, unknown>)?.items ?? null;
  } catch (err) {
    state.adminError = `Failed to load MCP setup config: ${String(err)}`;
  }
}

export async function updateMcpSetupConfig(
  state: AdminState,
  mcpName: string,
  enabled: boolean,
): Promise<void> {
  if (!state.client) {
    return;
  }
  // Optimistic update
  if (state.adminMcpSetupConfig) {
    state.adminMcpSetupConfig = state.adminMcpSetupConfig.map((item) =>
      item.mcp_name === mcpName ? { ...item, enabled_in_setup: enabled } : item,
    );
  }
  try {
    await state.client.request("sonance.admin.update_mcp_setup_config", {
      mcp_name: mcpName,
      enabled,
    });
  } catch (err) {
    state.adminError = `Failed to update setup config: ${String(err)}`;
    await loadMcpSetupConfig(state);
  }
}

// ---------------------------------------------------------------------------
// MCP Groups
// ---------------------------------------------------------------------------

export async function loadMcpGroups(state: AdminState): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    const result = await state.client.request("sonance.admin.mcp_groups");
    state.adminMcpGroups = (result as Record<string, unknown>)?.groups ?? null;
  } catch (err) {
    state.adminError = `Failed to load MCP groups: ${String(err)}`;
  }
}

export async function createMcpGroup(
  state: AdminState,
  name: string,
  description: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.create_mcp_group", {
      name,
      description: description || undefined,
    });
    state.adminMcpGroupCreating = false;
    await loadMcpGroups(state);
  } catch (err) {
    state.adminError = `Failed to create group: ${String(err)}`;
  }
}

export async function deleteMcpGroup(state: AdminState, groupId: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.delete_mcp_group", {
      group_id: groupId,
    });
    state.adminMcpExpandedGroupId = null;
    await loadMcpGroups(state);
  } catch (err) {
    state.adminError = `Failed to delete group: ${String(err)}`;
  }
}

export async function addGroupMembers(
  state: AdminState,
  groupId: string,
  userIds: string[],
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.add_group_members", {
      group_id: groupId,
      user_ids: userIds,
    });
    await loadMcpGroups(state);
  } catch (err) {
    state.adminError = `Failed to add members: ${String(err)}`;
  }
}

export async function removeGroupMember(
  state: AdminState,
  groupId: string,
  userId: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("sonance.admin.remove_group_member", {
      group_id: groupId,
      user_id: userId,
    });
    await loadMcpGroups(state);
  } catch (err) {
    state.adminError = `Failed to remove member: ${String(err)}`;
  }
}

export async function grantGroupAccess(
  state: AdminState,
  groupId: string,
  mcpName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  // Optimistic update
  if (state.adminMcpGroups) {
    state.adminMcpGroups = state.adminMcpGroups.map((g) =>
      g.id === groupId && !g.mcp_grants.includes(mcpName)
        ? { ...g, mcp_grants: [...g.mcp_grants, mcpName] }
        : g,
    );
  }
  try {
    await state.client.request("sonance.admin.grant_group_access", {
      group_id: groupId,
      mcp_name: mcpName,
    });
  } catch (err) {
    state.adminError = `Failed to grant group access: ${String(err)}`;
    await loadMcpGroups(state);
  }
}

export async function revokeGroupAccess(
  state: AdminState,
  groupId: string,
  mcpName: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  // Optimistic update
  if (state.adminMcpGroups) {
    state.adminMcpGroups = state.adminMcpGroups.map((g) =>
      g.id === groupId ? { ...g, mcp_grants: g.mcp_grants.filter((m) => m !== mcpName) } : g,
    );
  }
  try {
    await state.client.request("sonance.admin.revoke_group_access", {
      group_id: groupId,
      mcp_name: mcpName,
    });
  } catch (err) {
    state.adminError = `Failed to revoke group access: ${String(err)}`;
    await loadMcpGroups(state);
  }
}

export async function loadAdminData(state: AdminState): Promise<void> {
  switch (state.adminPanel) {
    case "users":
      return loadAdminUsers(state);
    case "usage":
      return loadAdminUsage(state);
    case "mcp":
      void loadMcpUserAccess(state);
      return loadAdminMcpAccess(state);
    case "activity": {
      const host = state as unknown as AdminActivityLogHost;
      void loadActivityLogFilterOptions(host);
      return loadActivityLog(host);
    }
  }
}
