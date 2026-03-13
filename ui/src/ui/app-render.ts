import { html, nothing } from "lit";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { t } from "../i18n/index.ts";
import { refreshChatAvatar } from "./app-chat.ts";
import { renderUsageTab } from "./app-render-usage-tab.ts";
import { renderChatControls, renderTab, renderThemeToggle } from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import {
  applyActivityLogFilter,
  goToActivityLogPage,
  type AdminActivityLogHost,
} from "./controllers/admin-activity-log.ts";
import {
  grantAllGitHubRepoAccess,
  grantAllMcpUserAccess,
  grantAllProjectAccess,
  grantAllVercelProjectAccess,
  grantDatabricksAccess,
  grantGitHubRepoAccess,
  grantMcpUserAccess,
  grantProjectAccess,
  grantVercelProjectAccess,
  loadAdminData,
  loadAdminDatabricksAccess,
  loadAdminGitHubRepoAccess,
  loadAdminProjectAccess,
  loadAdminUsers,
  loadAdminVercelProjectAccess,
  loadMcpGroups,
  loadMcpSetupConfig,
  loadMcpUserAccess,
  revokeAllMcpUserAccess,
  revokeDatabricksAccess,
  revokeMcpUserAccess,
  revokeAllGitHubRepoAccess,
  revokeAllProjectAccess,
  revokeAllVercelProjectAccess,
  revokeGitHubRepoAccess,
  revokeProjectAccess,
  revokeVercelProjectAccess,
  seedMcpUserAccess,
  updateMcpSetupConfig,
  createMcpGroup,
  deleteMcpGroup,
  addGroupMembers,
  removeGroupMember,
  grantGroupAccess,
  revokeGroupAccess,
  type AdminState,
} from "./controllers/admin.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import {
  initiateOAuthConnect,
  loadAgents,
  loadCortexConnections,
  loadCortexTools,
} from "./controllers/agents.ts";
import { loadApolloData } from "./controllers/apollo.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  applyConfig,
  loadConfig,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  loadCronRuns,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
  normalizeCronFormState,
} from "./controllers/cron.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import { deleteSessionAndRefresh, loadSessions, patchSession } from "./controllers/sessions.ts";
import {
  installSkill,
  loadCortexSkillDetail,
  loadSkills,
  saveSkillApiKey,
  toggleCortexSkill,
  updateSkillEdit,
  updateSkillEnabled,
} from "./controllers/skills.ts";
import {
  loadToolWhitelist,
  loadWhitelistMcp,
  loadWhitelistSkills,
  loadWhitelistNodes,
  loadWhitelistAgents,
  toggleToolWhitelist,
  toggleSkillWhitelist,
  toggleMcpWhitelist,
  toggleNodeWhitelist,
  type WhitelistTab,
} from "./controllers/tool-whitelist.ts";
import {
  loadUpstreamStatus,
  loadCommitDiff,
  analyzeCommits,
  applyCommits,
  reviewAllUpdates,
} from "./controllers/upstream-sync.ts";
import { icons } from "./icons.ts";
import { TAB_GROUPS, TAB_GROUPS_LEGACY, subtitleForTab, titleForTab } from "./navigation.ts";
import { renderAdminDatabricks } from "./views/admin-databricks.ts";
import { renderAdminGitHub } from "./views/admin-github.ts";
import { renderAdminMcps } from "./views/admin-mcps.ts";
import { renderAdminProjects } from "./views/admin-projects.ts";
import { renderAdminVercel } from "./views/admin-vercel.ts";
import { renderAdmin } from "./views/admin.ts";
import { renderAgents } from "./views/agents.ts";
import { renderApollo } from "./views/apollo.ts";
import { renderChannels } from "./views/channels.ts";
import { renderChat } from "./views/chat.ts";
import { renderConfig } from "./views/config.ts";
import { renderCron } from "./views/cron.ts";
import { renderDashboardIdentity } from "./views/dashboard-identity.ts";
import { renderDashboard } from "./views/dashboard-legacy.ts";
import { renderDebug } from "./views/debug.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderInstances } from "./views/instances.ts";
import { renderLanding } from "./views/landing.ts";
import { renderLogs } from "./views/logs.ts";
import { renderNodes } from "./views/nodes.ts";
import { renderOverview } from "./views/overview.ts";
import { renderSessions } from "./views/sessions.ts";
import { renderSkills } from "./views/skills.ts";
import { renderWhitelist } from "./views/tool-whitelist.ts";
import { renderUpstreamSync } from "./views/upstream-sync.ts";

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

export function renderApp(state: AppViewState) {
  // In cortex auth mode, show the public landing page when not authenticated.
  if (state.authMode === "cortex" && !state.cortexUser) {
    return renderLanding(state);
  }

  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;

  return html`
    <div class="shell ${isChat ? "shell--chat" : ""} ${chatFocus ? "shell--chat-focus" : ""} ${state.settings.navCollapsed ? "shell--nav-collapsed" : ""} ${state.onboarding ? "shell--onboarding" : ""}">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="nav-collapse-toggle"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
            aria-label="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
          >
            <span class="nav-collapse-toggle__icon">${icons.menu}</span>
          </button>
          <div class="brand">
            <div class="brand-orb" aria-hidden="true">
              <div class="brand-orb__glow"></div>
              <div class="brand-orb__sphere">
                <div class="brand-orb__highlight"></div>
              </div>
            </div>
            <div class="brand-text">
              <div class="brand-title">ATHENA</div>
              <div class="brand-sub">AI Identity</div>
            </div>
          </div>
        </div>
        <div class="topbar-status">
          <div class="pill">
            <span class="statusDot ${state.connected ? "ok" : ""}"></span>
            <span>${t("common.health")}</span>
            <span class="mono">${state.connected ? t("common.ok") : t("common.offline")}</span>
          </div>
          ${
            state.cortexUser
              ? html`<div class="cortex-user-badge">
                <span class="cortex-user-email">${state.cortexUser.displayName ?? state.cortexUser.email}</span>
                <button class="cortex-logout-btn" @click=${() => state.handleCortexLogout()} title="Sign out">
                  Sign out
                </button>
              </div>`
              : nothing
          }
          ${renderThemeToggle(state)}
        </div>
      </header>
      <aside class="nav ${state.settings.navCollapsed ? "nav--collapsed" : ""}">
        ${(state.settings.dashboardView === "legacy" ? TAB_GROUPS_LEGACY : TAB_GROUPS)
          .filter((group) => group.label !== "admin" || state.cortexUser?.role === "admin")
          .map((group) => {
            const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
            const hasActiveTab = group.tabs.some((tab) => tab === state.tab);
            return html`
            <div class="nav-group ${isGroupCollapsed && !hasActiveTab ? "nav-group--collapsed" : ""}">
              <button
                class="nav-label"
                @click=${() => {
                  const next = { ...state.settings.navGroupsCollapsed };
                  next[group.label] = !isGroupCollapsed;
                  state.applySettings({
                    ...state.settings,
                    navGroupsCollapsed: next,
                  });
                }}
                aria-expanded=${!isGroupCollapsed}
              >
                <span class="nav-label__text">${t(`nav.${group.label}`)}</span>
                <span class="nav-label__chevron">${isGroupCollapsed ? "+" : "−"}</span>
              </button>
              <div class="nav-group__items">
                ${group.tabs.map((tab) => renderTab(state, tab))}
              </div>
            </div>
          `;
          })}
        <div class="nav-group nav-group--links">
          <div class="nav-label nav-label--static">
            <span class="nav-label__text">${t("common.resources")}</span>
          </div>
          <div class="nav-group__items">
            <a
              class="nav-item nav-item--external"
              href="https://docs.openclaw.ai"
              target="_blank"
              rel="noreferrer"
              title="${t("common.docs")} (opens in new tab)"
            >
              <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
              <span class="nav-item__text">${t("common.docs")}</span>
            </a>
          </div>
        </div>
      </aside>
      <main class="content ${isChat ? "content--chat" : ""}">
        ${nothing}
        <section class="content-header">
          <div>
            ${state.tab === "usage" || state.tab === "dashboard" ? nothing : html`<div class="page-title">${titleForTab(state.tab)}</div>`}
            ${state.tab === "usage" || state.tab === "dashboard" ? nothing : html`<div class="page-sub">${subtitleForTab(state.tab)}</div>`}
          </div>
          <div class="page-meta">
            ${state.lastError ? html`<div class="pill danger">${state.lastError}</div>` : nothing}
            ${isChat ? renderChatControls(state) : nothing}
          </div>
        </section>

        ${
          state.tab === "dashboard"
            ? html`
                <div class="dashboard-view-toggle">
                  <button
                    class="dashboard-view-toggle__btn ${state.settings.dashboardView !== "legacy" ? "active" : ""}"
                    @click=${() => state.applySettings({ ...state.settings, dashboardView: "identity" })}
                  >
                    Identity
                  </button>
                  <button
                    class="dashboard-view-toggle__btn ${state.settings.dashboardView === "legacy" ? "active" : ""}"
                    @click=${() => {
                      state.applySettings({ ...state.settings, dashboardView: "legacy" });
                      void import("./controllers/dashboard.ts").then(({ loadDashboardData }) => {
                        void loadDashboardData(state);
                      });
                    }}
                  >
                    Classic
                  </button>
                </div>
                ${
                  state.settings.dashboardView === "legacy"
                    ? renderDashboard({
                        loading: state.dashboardLoading,
                        error: state.dashboardError,
                        widgets: state.dashboardWidgets,
                        connections: state.cortexConnections,
                        connectionsLoaded: state.cortexConnectionsLoaded,
                        lastRefreshAt: state.dashboardLastRefreshAt,
                        userName:
                          state.cortexUser?.displayName ??
                          state.cortexUser?.email?.split("@")[0] ??
                          null,
                        onRefresh: () => {
                          void import("./controllers/dashboard.ts").then(
                            ({ forceRefreshDashboard }) => {
                              void forceRefreshDashboard(state);
                            },
                          );
                        },
                        onRefreshWidget: (mcpName: string) => {
                          void import("./controllers/dashboard.ts").then(
                            ({ refreshDashboardWidget }) => {
                              void refreshDashboardWidget(state, mcpName);
                            },
                          );
                        },
                      })
                    : renderDashboardIdentity({
                        user: state.cortexUser ?? null,
                        connections: state.cortexConnections,
                        connectionsLoaded: state.cortexConnectionsLoaded,
                        dashboardStats: state.dashboardStats ?? null,
                        dashboardStatsLoading: state.dashboardStatsLoading,
                        connected: state.connected,
                        onLoadConnections: () => {
                          void loadCortexConnections(state);
                        },
                        onConnectMcp: (mcpName: string) => {
                          void initiateOAuthConnect(state, mcpName);
                        },
                      })
                }
              `
            : nothing
        }
        ${
          state.tab === "overview"
            ? renderOverview({
                connected: state.connected,
                hello: state.hello,
                settings: state.settings,
                password: state.password,
                lastError: state.lastError,
                presenceCount,
                sessionsCount,
                cronEnabled: state.cronStatus?.enabled ?? null,
                cronNext,
                lastChannelsRefresh: state.channelsLastSuccess,
                onSettingsChange: (next) => state.applySettings(next),
                onPasswordChange: (next) => (state.password = next),
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessage = "";
                  state.resetToolStream();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                },
                onConnect: () => state.connect(),
                onRefresh: () => state.loadOverview(),
              })
            : nothing
        }

        ${
          state.tab === "channels"
            ? renderChannels({
                connected: state.connected,
                loading: state.channelsLoading,
                snapshot: state.channelsSnapshot,
                lastError: state.channelsError,
                lastSuccessAt: state.channelsLastSuccess,
                whatsappMessage: state.whatsappLoginMessage,
                whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
                whatsappConnected: state.whatsappLoginConnected,
                whatsappBusy: state.whatsappBusy,
                configSchema: state.configSchema,
                configSchemaLoading: state.configSchemaLoading,
                configForm: state.configForm,
                configUiHints: state.configUiHints,
                configSaving: state.configSaving,
                configFormDirty: state.configFormDirty,
                nostrProfileFormState: state.nostrProfileFormState,
                nostrProfileAccountId: state.nostrProfileAccountId,
                onRefresh: (probe) => loadChannels(state, probe),
                onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
                onWhatsAppWait: () => state.handleWhatsAppWait(),
                onWhatsAppLogout: () => state.handleWhatsAppLogout(),
                onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
                onConfigSave: () => state.handleChannelConfigSave(),
                onConfigReload: () => state.handleChannelConfigReload(),
                onNostrProfileEdit: (accountId, profile) =>
                  state.handleNostrProfileEdit(accountId, profile),
                onNostrProfileCancel: () => state.handleNostrProfileCancel(),
                onNostrProfileFieldChange: (field, value) =>
                  state.handleNostrProfileFieldChange(field, value),
                onNostrProfileSave: () => state.handleNostrProfileSave(),
                onNostrProfileImport: () => state.handleNostrProfileImport(),
                onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
              })
            : nothing
        }

        ${
          state.tab === "instances"
            ? renderInstances({
                loading: state.presenceLoading,
                entries: state.presenceEntries,
                lastError: state.presenceError,
                statusMessage: state.presenceStatus,
                onRefresh: () => loadPresence(state),
              })
            : nothing
        }

        ${
          state.tab === "sessions"
            ? renderSessions({
                loading: state.sessionsLoading,
                result: state.sessionsResult,
                error: state.sessionsError,
                activeMinutes: state.sessionsFilterActive,
                limit: state.sessionsFilterLimit,
                includeGlobal: state.sessionsIncludeGlobal,
                includeUnknown: state.sessionsIncludeUnknown,
                basePath: state.basePath,
                onFiltersChange: (next) => {
                  state.sessionsFilterActive = next.activeMinutes;
                  state.sessionsFilterLimit = next.limit;
                  state.sessionsIncludeGlobal = next.includeGlobal;
                  state.sessionsIncludeUnknown = next.includeUnknown;
                },
                onRefresh: () => loadSessions(state),
                onPatch: (key, patch) => patchSession(state, key, patch),
                onDelete: (key) => deleteSessionAndRefresh(state, key),
              })
            : nothing
        }

        ${renderUsageTab(state)}

        ${
          state.tab === "apollo"
            ? renderApollo({
                loading: state.apolloLoading,
                error: state.apolloError,
                status: state.apolloStatus,
                usage: state.apolloUsage,
                activeTab: state.apolloTab,
                userFilter: state.apolloUserFilter,
                userSort: state.apolloUserSort,
                userSortDir: state.apolloUserSortDir,
                onRefresh: () => loadApolloData(state),
                onTabChange: (tab: "users" | "requests" | "models") => {
                  state.apolloTab = tab;
                },
                onUserFilterChange: (email: string) => {
                  state.apolloUserFilter = email;
                },
                onUserSortChange: (
                  field: import("./controllers/apollo.js").ApolloUserSortField,
                ) => {
                  if (state.apolloUserSort === field) {
                    state.apolloUserSortDir = state.apolloUserSortDir === "desc" ? "asc" : "desc";
                  } else {
                    state.apolloUserSort = field;
                    state.apolloUserSortDir = "desc";
                  }
                },
              })
            : nothing
        }

        ${
          state.tab === "whitelist"
            ? renderWhitelist({
                activeTab: state.whitelistTab,
                onTabChange: (tab: WhitelistTab) => {
                  state.whitelistTab = tab;
                  state.whitelistColumnFilters = {};
                  state.whitelistFilterOpen = null;
                  state.whitelistFilterSearch = "";
                  state.whitelistSearch = "";
                  state.whitelistCollapsed = {};
                  if (tab === "tools" && !state.toolWhitelistData && !state.toolWhitelistLoading) {
                    void loadToolWhitelist(state);
                  }
                  if (tab === "mcp" && !state.whitelistMcpData && !state.whitelistMcpLoading) {
                    void loadWhitelistMcp(state);
                  }
                  if (
                    tab === "skills" &&
                    !state.whitelistSkillsData &&
                    !state.whitelistSkillsLoading
                  ) {
                    void loadWhitelistSkills(state);
                  }
                  if (
                    tab === "nodes" &&
                    !state.whitelistNodesData &&
                    !state.whitelistNodesLoading
                  ) {
                    void loadWhitelistNodes(state);
                  }
                  if (
                    tab === "agents" &&
                    !state.whitelistAgentsData &&
                    !state.whitelistAgentsLoading
                  ) {
                    void loadWhitelistAgents(state);
                  }
                },
                busy: state.whitelistBusy,
                restartNeeded: state.whitelistRestartNeeded,
                onDismissRestart: () => {
                  state.whitelistRestartNeeded = false;
                },
                columnFilters: state.whitelistColumnFilters,
                filterOpen: state.whitelistFilterOpen,
                filterSearch: state.whitelistFilterSearch,
                onColumnFilterChange: (col: string, vals: string[]) => {
                  state.whitelistColumnFilters = { ...state.whitelistColumnFilters, [col]: vals };
                },
                onFilterDropdownToggle: (col: string | null) => {
                  state.whitelistFilterOpen = col;
                  state.whitelistFilterSearch = "";
                },
                onFilterSearchChange: (text: string) => {
                  state.whitelistFilterSearch = text;
                },
                search: state.whitelistSearch,
                onSearchChange: (text: string) => {
                  state.whitelistSearch = text;
                },
                collapsed: state.whitelistCollapsed,
                onToggleCollapse: (group: string) => {
                  state.whitelistCollapsed = {
                    ...state.whitelistCollapsed,
                    [group]: !state.whitelistCollapsed[group],
                  };
                },
                toolsLoading: state.toolWhitelistLoading,
                toolsError: state.toolWhitelistError,
                toolsData: state.toolWhitelistData,
                onToolsRefresh: () => loadToolWhitelist(state),
                onToolToggle: (name: string, allowed: boolean) =>
                  void toggleToolWhitelist(state, name, allowed),
                mcpLoading: state.whitelistMcpLoading,
                mcpError: state.whitelistMcpError,
                mcpData: state.whitelistMcpData,
                onMcpRefresh: () => loadWhitelistMcp(state),
                onMcpToggle: (name: string, register: boolean) =>
                  void toggleMcpWhitelist(state, name, register),
                skillsLoading: state.whitelistSkillsLoading,
                skillsError: state.whitelistSkillsError,
                skillsData: state.whitelistSkillsData,
                onSkillsRefresh: () => loadWhitelistSkills(state),
                onSkillToggle: (key: string, enabled: boolean) =>
                  void toggleSkillWhitelist(state, key, enabled),
                nodesLoading: state.whitelistNodesLoading,
                nodesError: state.whitelistNodesError,
                nodesData: state.whitelistNodesData,
                onNodesRefresh: () => loadWhitelistNodes(state),
                onNodeToggle: (nodeId: string, allowed: boolean) =>
                  void toggleNodeWhitelist(state, nodeId, allowed),
                agentsLoading: state.whitelistAgentsLoading,
                agentsError: state.whitelistAgentsError,
                agentsData: state.whitelistAgentsData,
                onAgentsRefresh: () => loadWhitelistAgents(state),
              })
            : nothing
        }

        ${
          state.tab === "upstream-sync"
            ? renderUpstreamSync({
                loading: state.upstreamSyncLoading,
                error: state.upstreamSyncError,
                status: state.upstreamSyncStatus,
                commits: state.upstreamSyncCommits,
                selectedCommits: state.upstreamSelectedCommits,
                expandedCommit: state.upstreamExpandedCommit,
                diffCache: state.upstreamDiffCache,
                analysis: state.upstreamAnalysis,
                analysisLoading: state.upstreamAnalysisLoading,
                applyResult: state.upstreamApplyResult,
                applyLoading: state.upstreamApplyLoading,
                fullReview: state.upstreamFullReview,
                fullReviewLoading: state.upstreamFullReviewLoading,
                onRefresh: () => loadUpstreamStatus(state),
                onFetch: () => loadUpstreamStatus(state, { fetch: true }),
                onToggleCommit: (hash: string) => {
                  const next = new Set(state.upstreamSelectedCommits);
                  if (next.has(hash)) {
                    next.delete(hash);
                  } else {
                    next.add(hash);
                  }
                  state.upstreamSelectedCommits = next;
                },
                onSelectAll: () => {
                  const all = new Set(
                    (state.upstreamSyncCommits?.commits ?? []).map((c) => c.hash),
                  );
                  state.upstreamSelectedCommits = all;
                },
                onDeselectAll: () => {
                  state.upstreamSelectedCommits = new Set();
                },
                onExpandCommit: (hash: string | null) => {
                  state.upstreamExpandedCommit = hash;
                },
                onLoadDiff: (hash: string) => {
                  void loadCommitDiff(state, hash).then(() => {
                    // Trigger re-render by updating the cache reference
                    state.upstreamDiffCache = new Map(state.upstreamDiffCache);
                  });
                },
                onAnalyze: () => void analyzeCommits(state),
                onApply: (opts) =>
                  void applyCommits(state, {
                    commits: opts.commits,
                    dryRun: opts.dryRun,
                  }),
                onDismissApplyResult: () => {
                  state.upstreamApplyResult = null;
                },
                onFullReview: () => void reviewAllUpdates(state),
              })
            : nothing
        }

        ${
          state.tab === "admin"
            ? renderAdmin({
                loading: state.adminLoading,
                error: state.adminError,
                activePanel: state.adminPanel,
                users: state.adminUsers,
                usersFilter: state.adminUsersFilter,
                usageSummary: state.adminUsageSummary,
                usageDetails: state.adminUsageDetails,
                mcps: state.adminMcps,
                mcpAccess: state.adminMcpAccess,
                onMcpGrant: (userId: string, mcpName: string) => {
                  void grantMcpUserAccess(state as unknown as AdminState, userId, mcpName);
                },
                onMcpRevoke: (userId: string, mcpName: string) => {
                  void revokeMcpUserAccess(state as unknown as AdminState, userId, mcpName);
                },
                onMcpSeed: () => {
                  void seedMcpUserAccess(state as unknown as AdminState);
                },
                activityLog: state.adminActivityLog,
                activityLogLoading: state.adminActivityLogLoading,
                activityFilters: state.adminActivityFilters,
                activityFilterOptions: state.adminActivityFilterOptions,
                activityExpandedId: state.adminActivityExpandedId,
                onPanelChange: (panel) => {
                  state.adminPanel = panel;
                  void loadAdminData(state as unknown as AdminState);
                },
                onUsersFilterChange: (filter) => {
                  state.adminUsersFilter = filter;
                },
                onActivityFilterChange: (key, value) => {
                  applyActivityLogFilter(state as unknown as AdminActivityLogHost, key, value);
                },
                onActivityPageChange: (page) => {
                  goToActivityLogPage(state as unknown as AdminActivityLogHost, page);
                },
                onActivityToggleExpand: (id) => {
                  state.adminActivityExpandedId = state.adminActivityExpandedId === id ? null : id;
                },
                onRefresh: () => {
                  void loadAdminData(state as unknown as AdminState);
                },
              })
            : nothing
        }

        ${
          state.tab === "supabase"
            ? (() => {
                const adminState = state as unknown as AdminState;
                if (!state.adminProjects) {
                  void loadAdminProjectAccess(adminState);
                  void loadAdminUsers(adminState);
                }
                return renderAdminProjects({
                  projects: state.adminProjects,
                  users: state.adminUsers,
                  expandedUserId: state.adminProjectsExpandedUserId,
                  onToggleExpand: (userId) => {
                    state.adminProjectsExpandedUserId =
                      state.adminProjectsExpandedUserId === userId ? null : userId;
                  },
                  onGrant: (userId, projectRef, projectName) => {
                    void grantProjectAccess(adminState, userId, projectRef, projectName);
                  },
                  onRevoke: (userId, projectRef) => {
                    void revokeProjectAccess(adminState, userId, projectRef);
                  },
                  onGrantAll: (userId) => {
                    void grantAllProjectAccess(adminState, userId);
                  },
                  onRevokeAll: (userId) => {
                    void revokeAllProjectAccess(adminState, userId);
                  },
                });
              })()
            : nothing
        }

        ${
          state.tab === "github"
            ? (() => {
                const adminState = state as unknown as AdminState;
                if (!state.adminGitHubRepos) {
                  void loadAdminGitHubRepoAccess(adminState);
                  void loadAdminUsers(adminState);
                }
                return renderAdminGitHub({
                  repos: state.adminGitHubRepos,
                  users: state.adminUsers,
                  expandedUserId: state.adminGitHubExpandedUserId,
                  onToggleExpand: (userId) => {
                    state.adminGitHubExpandedUserId =
                      state.adminGitHubExpandedUserId === userId ? null : userId;
                  },
                  onGrant: (userId, repoFullName, repoName) => {
                    void grantGitHubRepoAccess(adminState, userId, repoFullName, repoName);
                  },
                  onRevoke: (userId, repoFullName) => {
                    void revokeGitHubRepoAccess(adminState, userId, repoFullName);
                  },
                  onGrantAll: (userId) => {
                    void grantAllGitHubRepoAccess(adminState, userId);
                  },
                  onRevokeAll: (userId) => {
                    void revokeAllGitHubRepoAccess(adminState, userId);
                  },
                });
              })()
            : nothing
        }

        ${
          state.tab === "vercel"
            ? (() => {
                const adminState = state as unknown as AdminState;
                if (!state.adminVercelProjects) {
                  void loadAdminVercelProjectAccess(adminState);
                  void loadAdminUsers(adminState);
                }
                return renderAdminVercel({
                  projects: state.adminVercelProjects,
                  users: state.adminUsers,
                  expandedUserId: state.adminVercelExpandedUserId,
                  onToggleExpand: (userId) => {
                    state.adminVercelExpandedUserId =
                      state.adminVercelExpandedUserId === userId ? null : userId;
                  },
                  onGrant: (userId, projectId, projectName) => {
                    void grantVercelProjectAccess(adminState, userId, projectId, projectName);
                  },
                  onRevoke: (userId, projectId) => {
                    void revokeVercelProjectAccess(adminState, userId, projectId);
                  },
                  onGrantAll: (userId) => {
                    void grantAllVercelProjectAccess(adminState, userId);
                  },
                  onRevokeAll: (userId) => {
                    void revokeAllVercelProjectAccess(adminState, userId);
                  },
                });
              })()
            : nothing
        }

        ${
          state.tab === "databricks"
            ? (() => {
                const adminState = state as unknown as AdminState;
                if (!state.adminDatabricksCatalogs) {
                  void loadAdminDatabricksAccess(adminState);
                  void loadAdminUsers(adminState);
                }
                return renderAdminDatabricks({
                  catalogs: state.adminDatabricksCatalogs,
                  users: state.adminUsers,
                  expandedUserId: state.adminDatabricksExpandedUserId,
                  onToggleExpand: (userId) => {
                    state.adminDatabricksExpandedUserId =
                      state.adminDatabricksExpandedUserId === userId ? null : userId;
                  },
                  onGrant: (userId, catalogName) => {
                    void grantDatabricksAccess(adminState, userId, catalogName);
                  },
                  onRevoke: (userId, catalogName) => {
                    void revokeDatabricksAccess(adminState, userId, catalogName);
                  },
                });
              })()
            : nothing
        }

        ${
          state.tab === "mcps"
            ? (() => {
                const adminState = state as unknown as AdminState;
                if (!state.adminMcpUserAccess) {
                  void loadMcpUserAccess(adminState);
                  void loadAdminUsers(adminState);
                }
                if (!state.adminMcpSetupConfig) {
                  void loadMcpSetupConfig(adminState);
                }
                if (!state.adminMcpGroups) {
                  void loadMcpGroups(adminState);
                }
                return renderAdminMcps({
                  mcps: state.adminMcpUserAccess,
                  users: state.adminUsers,
                  expandedMcpName: state.adminMcpExpandedName,
                  onToggleMcp: (mcpName) => {
                    state.adminMcpExpandedName =
                      state.adminMcpExpandedName === mcpName ? null : mcpName;
                  },
                  onGrant: (userId, mcpName) => {
                    void grantMcpUserAccess(adminState, userId, mcpName);
                  },
                  onRevoke: (userId, mcpName) => {
                    void revokeMcpUserAccess(adminState, userId, mcpName);
                  },
                  onGrantAll: (mcpName) => {
                    void grantAllMcpUserAccess(adminState, mcpName);
                  },
                  onRevokeAll: (mcpName) => {
                    void revokeAllMcpUserAccess(adminState, mcpName);
                  },
                  onSeed: () => {
                    void seedMcpUserAccess(adminState);
                  },
                  mcpSetupConfig: state.adminMcpSetupConfig,
                  onToggleSetup: (mcpName, enabled) => {
                    void updateMcpSetupConfig(adminState, mcpName, enabled);
                  },
                  groups: state.adminMcpGroups,
                  expandedGroupId: state.adminMcpExpandedGroupId,
                  groupCreating: state.adminMcpGroupCreating,
                  onToggleGroup: (groupId) => {
                    state.adminMcpExpandedGroupId =
                      state.adminMcpExpandedGroupId === groupId ? null : groupId;
                  },
                  onCreateGroup: (name, description) => {
                    void createMcpGroup(adminState, name, description);
                  },
                  onDeleteGroup: (groupId) => {
                    void deleteMcpGroup(adminState, groupId);
                  },
                  onAddGroupMembers: (groupId, userIds) => {
                    void addGroupMembers(adminState, groupId, userIds);
                  },
                  onRemoveGroupMember: (groupId, userId) => {
                    void removeGroupMember(adminState, groupId, userId);
                  },
                  onGrantGroupAccess: (groupId, mcpName) => {
                    void grantGroupAccess(adminState, groupId, mcpName);
                  },
                  onRevokeGroupAccess: (groupId, mcpName) => {
                    void revokeGroupAccess(adminState, groupId, mcpName);
                  },
                  onShowCreateGroup: () => {
                    state.adminMcpGroupCreating = !state.adminMcpGroupCreating;
                  },
                  loading: state.adminLoading,
                });
              })()
            : nothing
        }

        ${
          state.tab === "cron"
            ? renderCron({
                basePath: state.basePath,
                loading: state.cronLoading,
                status: state.cronStatus,
                jobs: state.cronJobs,
                error: state.cronError,
                busy: state.cronBusy,
                form: state.cronForm,
                channels: state.channelsSnapshot?.channelMeta?.length
                  ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                  : (state.channelsSnapshot?.channelOrder ?? []),
                channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                runsJobId: state.cronRunsJobId,
                runs: state.cronRuns,
                onFormChange: (patch) =>
                  (state.cronForm = normalizeCronFormState({ ...state.cronForm, ...patch })),
                onRefresh: () => state.loadCron(),
                onAdd: () => addCronJob(state),
                onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
                onRun: (job) => runCronJob(state, job),
                onRemove: (job) => removeCronJob(state, job),
                onLoadRuns: (jobId) => loadCronRuns(state, jobId),
              })
            : nothing
        }

        ${
          state.tab === "agents"
            ? renderAgents({
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: state.agentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                configForm: configValue,
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                channelsLoading: state.channelsLoading,
                channelsError: state.channelsError,
                channelsSnapshot: state.channelsSnapshot,
                channelsLastSuccess: state.channelsLastSuccess,
                cronLoading: state.cronLoading,
                cronStatus: state.cronStatus,
                cronJobs: state.cronJobs,
                cronError: state.cronError,
                agentFilesLoading: state.agentFilesLoading,
                agentFilesError: state.agentFilesError,
                agentFilesList: state.agentFilesList,
                agentFileActive: state.agentFileActive,
                agentFileContents: state.agentFileContents,
                agentFileDrafts: state.agentFileDrafts,
                agentFileSaving: state.agentFileSaving,
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkillsLoading: state.agentSkillsLoading,
                agentSkillsReport: state.agentSkillsReport,
                agentSkillsError: state.agentSkillsError,
                agentSkillsAgentId: state.agentSkillsAgentId,
                cortexToolGroups: state.cortexToolGroups,
                cortexConnections: state.cortexConnections,
                onConnectOAuth: (mcpName: string) => {
                  void initiateOAuthConnect(state, mcpName);
                },
                skillsFilter: state.skillsFilter,
                sidebarSearch: state.agentsSidebarSearch,
                onSidebarSearchChange: (value: string) => {
                  state.agentsSidebarSearch = value;
                },
                onRefresh: async () => {
                  // Re-sync tools from Cortex (discovers new MCPs)
                  try {
                    await state.client?.request("cortex.sync", {});
                  } catch {
                    // cortex-tools plugin may not be loaded; continue with agents.list
                  }
                  await loadAgents(state);
                  // Refresh Cortex tool groups and connections for the Tools tab
                  state.cortexToolsLoaded = false;
                  state.cortexConnectionsLoaded = false;
                  void loadCortexTools(state);
                  void loadCortexConnections(state);
                  const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                },
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  state.agentFilesList = null;
                  state.agentFilesError = null;
                  state.agentFilesLoading = false;
                  state.agentFileActive = null;
                  state.agentFileContents = {};
                  state.agentFileDrafts = {};
                  state.agentSkillsReport = null;
                  state.agentSkillsError = null;
                  state.agentSkillsAgentId = null;
                  void loadAgentIdentity(state, agentId);
                  if (state.agentsPanel === "files") {
                    void loadAgentFiles(state, agentId);
                  }
                  if (state.agentsPanel === "skills") {
                    void loadAgentSkills(state, agentId);
                  }
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (panel === "tools" && !state.cortexToolsLoaded) {
                    void loadCortexTools(state);
                  }
                  if (panel === "tools" && !state.cortexConnectionsLoaded) {
                    void loadCortexConnections(state);
                  }
                  if (panel === "files" && resolvedAgentId) {
                    if (state.agentFilesList?.agentId !== resolvedAgentId) {
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      void loadAgentFiles(state, resolvedAgentId);
                    }
                  }
                  if (panel === "skills") {
                    if (resolvedAgentId) {
                      void loadAgentSkills(state, resolvedAgentId);
                    }
                  }
                  if (panel === "channels") {
                    void loadChannels(state, false);
                  }
                  if (panel === "cron") {
                    void state.loadCron();
                  }
                },
                onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (profile) {
                    updateConfigFormValue(state, [...basePath, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePath, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePath, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePath, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePath, "deny"]);
                  }
                },
                onConfigReload: () => loadConfig(state),
                onConfigSave: () => saveConfig(state),
                onChannelsRefresh: () => loadChannels(state, false),
                onCronRefresh: () => state.loadCron(),
                onSkillsFilterChange: (next) => (state.skillsFilter = next),
                onSkillsRefresh: () => {
                  if (resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                },
                onAgentSkillToggle: (agentId, skillName, enabled) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const entry = list[index] as { skills?: unknown };
                  const normalizedSkill = skillName.trim();
                  if (!normalizedSkill) {
                    return;
                  }
                  const allSkills =
                    state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ??
                    [];
                  const existing = Array.isArray(entry.skills)
                    ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
                    : undefined;
                  const base = existing ?? allSkills;
                  const next = new Set(base);
                  if (enabled) {
                    next.add(normalizedSkill);
                  } else {
                    next.delete(normalizedSkill);
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                },
                onAgentSkillsClear: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                },
                onAgentSkillsDisableAll: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                },
                onModelChange: (agentId, modelId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  if (!modelId) {
                    removeConfigFormValue(state, basePath);
                    return;
                  }
                  const entry = list[index] as { model?: unknown };
                  const existing = entry?.model;
                  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                    const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                    const next = {
                      primary: modelId,
                      ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                    };
                    updateConfigFormValue(state, basePath, next);
                  } else {
                    updateConfigFormValue(state, basePath, modelId);
                  }
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  const entry = list[index] as { model?: unknown };
                  const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                  const existing = entry.model;
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary();
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePath, primary);
                    } else {
                      removeConfigFormValue(state, basePath);
                    }
                    return;
                  }
                  const next = primary
                    ? { primary, fallbacks: normalized }
                    : { fallbacks: normalized };
                  updateConfigFormValue(state, basePath, next);
                },
              })
            : nothing
        }

        ${
          state.tab === "skills"
            ? renderSkills({
                loading: state.skillsLoading,
                report: state.skillsReport,
                error: state.skillsError,
                filter: state.skillsFilter,
                edits: state.skillEdits,
                messages: state.skillMessages,
                busyKey: state.skillsBusyKey,
                cortexSkills: state.cortexSkills,
                cortexSkillsError: state.cortexSkillsError,
                cortexSkillDetail: state.cortexSkillDetail,
                cortexSkillDetailName: state.cortexSkillDetailName,
                onFilterChange: (next) => (state.skillsFilter = next),
                onRefresh: () => loadSkills(state, { clearMessages: true }),
                onToggle: (key, enabled) => updateSkillEnabled(state, key, enabled),
                onEdit: (key, value) => updateSkillEdit(state, key, value),
                onSaveKey: (key) => saveSkillApiKey(state, key),
                onInstall: (skillKey, name, installId) =>
                  installSkill(state, skillKey, name, installId),
                onCortexToggle: (name, enabled) => toggleCortexSkill(state, name, enabled),
                onCortexDetail: (name) => loadCortexSkillDetail(state, name),
                onCortexDetailClose: () => {
                  state.cortexSkillDetail = null;
                  state.cortexSkillDetailName = null;
                },
              })
            : nothing
        }

        ${
          state.tab === "nodes"
            ? renderNodes({
                loading: state.nodesLoading,
                nodes: state.nodes,
                devicesLoading: state.devicesLoading,
                devicesError: state.devicesError,
                devicesList: state.devicesList,
                configForm:
                  state.configForm ??
                  (state.configSnapshot?.config as Record<string, unknown> | null),
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                configFormMode: state.configFormMode,
                execApprovalsLoading: state.execApprovalsLoading,
                execApprovalsSaving: state.execApprovalsSaving,
                execApprovalsDirty: state.execApprovalsDirty,
                execApprovalsSnapshot: state.execApprovalsSnapshot,
                execApprovalsForm: state.execApprovalsForm,
                execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                execApprovalsTarget: state.execApprovalsTarget,
                execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                onRefresh: () => loadNodes(state),
                onDevicesRefresh: () => loadDevices(state),
                onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
                onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
                onDeviceRotate: (deviceId, role, scopes) =>
                  rotateDeviceToken(state, { deviceId, role, scopes }),
                onDeviceRevoke: (deviceId, role) => revokeDeviceToken(state, { deviceId, role }),
                onLoadConfig: () => loadConfig(state),
                onLoadExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return loadExecApprovals(state, target);
                },
                onBindDefault: (nodeId) => {
                  if (nodeId) {
                    updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  } else {
                    removeConfigFormValue(state, ["tools", "exec", "node"]);
                  }
                },
                onBindAgent: (agentIndex, nodeId) => {
                  const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
                  if (nodeId) {
                    updateConfigFormValue(state, basePath, nodeId);
                  } else {
                    removeConfigFormValue(state, basePath);
                  }
                },
                onSaveBindings: () => saveConfig(state),
                onExecApprovalsTargetChange: (kind, nodeId) => {
                  state.execApprovalsTarget = kind;
                  state.execApprovalsTargetNodeId = nodeId;
                  state.execApprovalsSnapshot = null;
                  state.execApprovalsForm = null;
                  state.execApprovalsDirty = false;
                  state.execApprovalsSelectedAgent = null;
                },
                onExecApprovalsSelectAgent: (agentId) => {
                  state.execApprovalsSelectedAgent = agentId;
                },
                onExecApprovalsPatch: (path, value) =>
                  updateExecApprovalsFormValue(state, path, value),
                onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                onSaveExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return saveExecApprovals(state, target);
                },
              })
            : nothing
        }

        ${
          state.tab === "chat"
            ? renderChat({
                sessionKey: state.sessionKey,
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessage = "";
                  state.chatAttachments = [];
                  state.chatStream = null;
                  state.chatStreamStartedAt = null;
                  state.chatRunId = null;
                  state.chatQueue = [];
                  state.resetToolStream();
                  state.resetChatScroll();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                  void loadChatHistory(state);
                  void refreshChatAvatar(state);
                },
                thinkingLevel: state.chatThinkingLevel,
                showThinking,
                loading: state.chatLoading,
                sending: state.chatSending,
                compactionStatus: state.compactionStatus,
                assistantAvatarUrl: chatAvatarUrl,
                messages: state.chatMessages,
                toolMessages: state.chatToolMessages,
                stream: state.chatStream,
                streamStartedAt: state.chatStreamStartedAt,
                draft: state.chatMessage,
                queue: state.chatQueue,
                connected: state.connected,
                canSend: state.connected,
                disabledReason: chatDisabledReason,
                error: state.lastError,
                sessions: state.sessionsResult,
                focusMode: chatFocus,
                onRefresh: () => {
                  state.resetToolStream();
                  return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
                },
                onToggleFocusMode: () => {
                  if (state.onboarding) {
                    return;
                  }
                  state.applySettings({
                    ...state.settings,
                    chatFocusMode: !state.settings.chatFocusMode,
                  });
                },
                onChatScroll: (event) => state.handleChatScroll(event),
                onDraftChange: (next) => (state.chatMessage = next),
                attachments: state.chatAttachments,
                onAttachmentsChange: (next) => (state.chatAttachments = next),
                onSend: () => state.handleSendChat(),
                canAbort: Boolean(state.chatRunId),
                onAbort: () => void state.handleAbortChat(),
                onQueueRemove: (id) => state.removeQueuedMessage(id),
                onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
                showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                onScrollToBottom: () => state.scrollToBottom(),
                // Sidebar props for tool output viewing
                sidebarOpen: state.sidebarOpen,
                sidebarContent: state.sidebarContent,
                sidebarError: state.sidebarError,
                splitRatio: state.splitRatio,
                onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
                onCloseSidebar: () => state.handleCloseSidebar(),
                onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
                assistantName: state.assistantName,
                assistantAvatar: state.assistantAvatar,
              })
            : nothing
        }

        ${
          state.tab === "config"
            ? renderConfig({
                raw: state.configRaw,
                originalRaw: state.configRawOriginal,
                valid: state.configValid,
                issues: state.configIssues,
                loading: state.configLoading,
                saving: state.configSaving,
                applying: state.configApplying,
                updating: state.updateRunning,
                connected: state.connected,
                schema: state.configSchema,
                schemaLoading: state.configSchemaLoading,
                uiHints: state.configUiHints,
                formMode: state.configFormMode,
                formValue: state.configForm,
                originalValue: state.configFormOriginal,
                searchQuery: state.configSearchQuery,
                activeSection: state.configActiveSection,
                activeSubsection: state.configActiveSubsection,
                onRawChange: (next) => {
                  state.configRaw = next;
                },
                onFormModeChange: (mode) => (state.configFormMode = mode),
                onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                onSearchChange: (query) => (state.configSearchQuery = query),
                onSectionChange: (section) => {
                  state.configActiveSection = section;
                  state.configActiveSubsection = null;
                },
                onSubsectionChange: (section) => (state.configActiveSubsection = section),
                onReload: () => loadConfig(state),
                onSave: () => saveConfig(state),
                onApply: () => applyConfig(state),
                onUpdate: () => runUpdate(state),
              })
            : nothing
        }

        ${
          state.tab === "debug"
            ? renderDebug({
                loading: state.debugLoading,
                status: state.debugStatus,
                health: state.debugHealth,
                models: state.debugModels,
                heartbeat: state.debugHeartbeat,
                eventLog: state.eventLog,
                callMethod: state.debugCallMethod,
                callParams: state.debugCallParams,
                callResult: state.debugCallResult,
                callError: state.debugCallError,
                onCallMethodChange: (next) => (state.debugCallMethod = next),
                onCallParamsChange: (next) => (state.debugCallParams = next),
                onRefresh: () => loadDebug(state),
                onCall: () => callDebugMethod(state),
              })
            : nothing
        }

        ${
          state.tab === "logs"
            ? renderLogs({
                loading: state.logsLoading,
                error: state.logsError,
                file: state.logsFile,
                entries: state.logsEntries,
                filterText: state.logsFilterText,
                levelFilters: state.logsLevelFilters,
                autoFollow: state.logsAutoFollow,
                truncated: state.logsTruncated,
                onFilterTextChange: (next) => (state.logsFilterText = next),
                onLevelToggle: (level, enabled) => {
                  state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                },
                onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                onRefresh: () => loadLogs(state, { reset: true }),
                onExport: (lines, label) => state.exportLogs(lines, label),
                onScroll: (event) => state.handleLogsScroll(event),
              })
            : nothing
        }
      </main>
      ${renderExecApprovalPrompt(state)}
      ${renderGatewayUrlConfirmation(state)}
    </div>
  `;
}
