import type { EventLogEntry } from "./app-events.ts";
import type { CompactionStatus } from "./app-tool-stream.ts";
import type {
  ApolloStatusResult,
  ApolloUsageResult,
  ApolloUserSortField,
} from "./controllers/apollo.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type {
  ToolWhitelistResult,
  McpAuditResult,
  SkillsAuditResult,
  NodesAuditResult,
  AgentsAuditResult,
  WhitelistTab,
} from "./controllers/tool-whitelist.ts";
import type {
  UpstreamStatusResult,
  UpstreamCommitsResult,
  DiffResult,
  AnalysisResult,
  ApplyResult,
  FullReviewResult,
} from "./controllers/upstream-sync.ts";
import type { CortexAuthSession } from "./cortex-auth.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ThemeMode } from "./theme.ts";
import type {
  AdminMcpAccessEntry,
  AdminMcpInfo,
  AdminUsageDetail,
  AdminUsageSummary,
  AdminUser,
} from "./types-admin.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ChannelsStatusSnapshot,
  ConfigSnapshot,
  ConfigUiHints,
  CortexSkillDetailResponse,
  CortexSkillSummary,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  NostrProfile,
  PresenceEntry,
  SessionsUsageResult,
  CostUsageSummary,
  SessionUsageTimeSeries,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
} from "./types.ts";
import type { ChatAttachment, ChatQueueItem, CronFormState } from "./ui-types.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";
import type { SessionLogEntry } from "./views/usage.ts";

export type AppViewState = {
  settings: UiSettings;
  password: string;
  tab: Tab;
  onboarding: boolean;
  basePath: string;
  connected: boolean;
  theme: ThemeMode;
  themeResolved: "light" | "dark";
  hello: GatewayHelloOk | null;
  lastError: string | null;
  eventLog: EventLogEntry[];
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  sessionKey: string;
  chatLoading: boolean;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatRunId: string | null;
  compactionStatus: CompactionStatus | null;
  chatAvatarUrl: string | null;
  chatThinkingLevel: string | null;
  chatQueue: ChatQueueItem[];
  chatManualRefreshInFlight: boolean;
  nodesLoading: boolean;
  nodes: Array<Record<string, unknown>>;
  chatNewMessagesBelow: boolean;
  sidebarOpen: boolean;
  sidebarContent: string | null;
  sidebarError: string | null;
  splitRatio: number;
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  pendingGatewayUrl: string | null;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  applySessionKey: string;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  channelsLoading: boolean;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  channelsLastSuccess: number | null;
  whatsappLoginMessage: string | null;
  whatsappLoginQrDataUrl: string | null;
  whatsappLoginConnected: boolean | null;
  whatsappBusy: boolean;
  nostrProfileFormState: NostrProfileFormState | null;
  nostrProfileAccountId: string | null;
  configFormDirty: boolean;
  presenceLoading: boolean;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: string | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  agentsSelectedId: string | null;
  agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  agentsSidebarSearch: string;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
  cortexToolGroups: import("./views/agents-utils.js").PluginToolGroup[] | null;
  cortexToolsLoaded: boolean;
  cortexConnections: import("./controllers/agents.js").MCPConnection[] | null;
  cortexConnectionsLoaded: boolean;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  usageLoading: boolean;
  usageResult: SessionsUsageResult | null;
  usageCostSummary: CostUsageSummary | null;
  usageError: string | null;
  usageStartDate: string;
  usageEndDate: string;
  usageSelectedSessions: string[];
  usageSelectedDays: string[];
  usageSelectedHours: number[];
  usageChartMode: "tokens" | "cost";
  usageDailyChartMode: "total" | "by-type";
  usageTimeSeriesMode: "cumulative" | "per-turn";
  usageTimeSeriesBreakdownMode: "total" | "by-type";
  usageTimeSeries: SessionUsageTimeSeries | null;
  usageTimeSeriesLoading: boolean;
  usageTimeSeriesCursorStart: number | null;
  usageTimeSeriesCursorEnd: number | null;
  usageSessionLogs: SessionLogEntry[] | null;
  usageSessionLogsLoading: boolean;
  usageSessionLogsExpanded: boolean;
  usageQuery: string;
  usageQueryDraft: string;
  usageQueryDebounceTimer: number | null;
  usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors";
  usageSessionSortDir: "asc" | "desc";
  usageRecentSessions: string[];
  usageTimeZone: "local" | "utc";
  usageContextExpanded: boolean;
  usageHeaderPinned: boolean;
  usageSessionsTab: "all" | "recent";
  usageVisibleColumns: string[];
  usageLogFilterRoles: import("./views/usage.js").SessionLogRole[];
  usageLogFilterTools: string[];
  usageLogFilterHasTools: boolean;
  usageLogFilterQuery: string;
  apolloLoading: boolean;
  apolloError: string | null;
  apolloStatus: ApolloStatusResult | null;
  apolloUsage: ApolloUsageResult | null;
  apolloTab: "users" | "requests" | "models";
  apolloUserFilter: string;
  apolloUserSort: ApolloUserSortField;
  apolloUserSortDir: "asc" | "desc";
  toolWhitelistLoading: boolean;
  toolWhitelistError: string | null;
  toolWhitelistData: ToolWhitelistResult | null;
  toolWhitelistFilter: "all" | "allowed" | "denied" | "unreviewed";
  whitelistTab: WhitelistTab;
  whitelistMcpLoading: boolean;
  whitelistMcpError: string | null;
  whitelistMcpData: McpAuditResult | null;
  whitelistSkillsLoading: boolean;
  whitelistSkillsError: string | null;
  whitelistSkillsData: SkillsAuditResult | null;
  whitelistNodesLoading: boolean;
  whitelistNodesError: string | null;
  whitelistNodesData: NodesAuditResult | null;
  whitelistAgentsLoading: boolean;
  whitelistAgentsError: string | null;
  whitelistAgentsData: AgentsAuditResult | null;
  whitelistBusy: string | null;
  whitelistRestartNeeded: boolean;
  whitelistColumnFilters: Record<string, string[]>;
  whitelistFilterOpen: string | null;
  whitelistFilterSearch: string;
  whitelistSearch: string;
  whitelistCollapsed: Record<string, boolean>;
  upstreamSyncLoading: boolean;
  upstreamSyncError: string | null;
  upstreamSyncStatus: UpstreamStatusResult | null;
  upstreamSyncCommits: UpstreamCommitsResult | null;
  upstreamSelectedCommits: Set<string>;
  upstreamExpandedCommit: string | null;
  upstreamDiffCache: Map<string, DiffResult>;
  upstreamAnalysis: AnalysisResult | null;
  upstreamAnalysisLoading: boolean;
  upstreamApplyResult: ApplyResult | null;
  upstreamApplyLoading: boolean;
  upstreamFullReview: FullReviewResult | null;
  upstreamFullReviewLoading: boolean;
  dashboardStats: import("./controllers/dashboard-stats.ts").DashboardStats | null;
  dashboardStatsLoading: boolean;
  adminPanel: "users" | "usage" | "mcp";
  adminLoading: boolean;
  adminError: string | null;
  adminUsers: AdminUser[] | null;
  adminUsersFilter: string;
  adminUsageSummary: AdminUsageSummary | null;
  adminUsageDetails: AdminUsageDetail[] | null;
  adminMcps: AdminMcpInfo[] | null;
  adminMcpAccess: AdminMcpAccessEntry[] | null;
  dashboardLoading: boolean;
  dashboardError: string | null;
  dashboardWidgets: Record<string, import("./types-dashboard.js").DashboardWidgetData>;
  dashboardLastRefreshAt: number | null;
  platformStatsLoading: boolean;
  platformStatsError: string | null;
  platformStats: import("./controllers/platform.js").PlatformStats | null;
  platformAgentStats: import("./controllers/platform.js").AgentStatsEntry[] | null;
  platformConversationsLoading: boolean;
  platformConversationsError: string | null;
  platformConversations: import("./controllers/platform.js").PlatformConversation[] | null;
  platformConversationsFilter: {
    agentId?: string;
    userId?: string;
    gateway?: string;
    search?: string;
  };
  platformSelectedConversation: string | null;
  platformMessages: import("./controllers/platform.js").PlatformMessage[] | null;
  platformMessagesLoading: boolean;
  platformMemoryLoading: boolean;
  platformMemoryError: string | null;
  platformMemory: import("./controllers/platform.js").PlatformMemoryEntry[] | null;
  platformMemoryFilter: { agentId?: string; userId?: string; category?: string; search?: string };
  platformAuditLoading: boolean;
  platformAuditError: string | null;
  platformAudit: import("./controllers/platform.js").PlatformAuditEvent[] | null;
  platformAuditFilter: { agentId?: string; eventType?: string };
  platformMetrics: import("./controllers/platform.js").PlatformMetric[] | null;
  platformMetricsLoading: boolean;
  cronLoading: boolean;
  cronJobs: CronJob[];
  cronStatus: CronStatus | null;
  cronError: string | null;
  cronForm: CronFormState;
  cronRunsJobId: string | null;
  cronRuns: CronRunLogEntry[];
  cronBusy: boolean;
  skillsLoading: boolean;
  skillsReport: SkillStatusReport | null;
  skillsError: string | null;
  skillsFilter: string;
  skillEdits: Record<string, string>;
  skillMessages: Record<string, SkillMessage>;
  skillsBusyKey: string | null;
  cortexSkills: CortexSkillSummary[];
  cortexSkillsError: string | null;
  cortexSkillDetail: CortexSkillDetailResponse | null;
  cortexSkillDetailName: string | null;
  debugLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugHeartbeat: unknown;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
  logsLoading: boolean;
  logsError: string | null;
  logsFile: string | null;
  logsEntries: LogEntry[];
  logsFilterText: string;
  logsLevelFilters: Record<LogLevel, boolean>;
  logsAutoFollow: boolean;
  logsTruncated: boolean;
  logsCursor: number | null;
  logsLastFetchAt: number | null;
  logsLimit: number;
  logsMaxBytes: number;
  logsAtBottom: boolean;
  updateAvailable: import("./types.js").UpdateAvailable | null;
  /** Gateway auth mode from bootstrap (e.g. "token", "cortex", "sonance-sso"). */
  authMode: string;
  /** Cortex URL for SSO login (only set when authMode is "cortex"). */
  cortexUrl: string | null;
  /** Supabase project URL for direct auth (only set when authMode is "cortex"). */
  supabaseUrl: string | null;
  /** Supabase anon key for direct auth (only set when authMode is "cortex"). */
  supabaseAnonKey: string | null;
  /** SSO email domain (e.g. "sonance.com"). */
  ssoDomain: string | null;
  /** AI Intranet URL for redirect-based SSO (e.g. "https://aiintranet.sonance.com"). */
  aiIntranetUrl: string | null;
  /** Application ID in the AI Intranet for central-check validation. */
  appId: string | null;
  /** Current Cortex user session (after successful login). */
  cortexUser: CortexAuthSession | null;
  /** Whether Cortex login is in progress. */
  cortexLoginLoading: boolean;
  /** Error from Cortex login flow. */
  cortexLoginError: string | null;
  /** Status message during login flow. */
  cortexLoginStatus: string | null;
  /** Initiate Cortex SSO login. */
  handleCortexLogin: () => Promise<void>;
  /** Log out of Cortex session. */
  handleCortexLogout: () => void;
  client: GatewayBrowserClient | null;
  refreshSessionsAfterChat: Set<string>;
  connect: () => void;
  setTab: (tab: Tab) => void;
  setTheme: (theme: ThemeMode, context?: ThemeTransitionContext) => void;
  applySettings: (next: UiSettings) => void;
  loadOverview: () => Promise<void>;
  loadAssistantIdentity: () => Promise<void>;
  loadCron: () => Promise<void>;
  handleWhatsAppStart: (force: boolean) => Promise<void>;
  handleWhatsAppWait: () => Promise<void>;
  handleWhatsAppLogout: () => Promise<void>;
  handleChannelConfigSave: () => Promise<void>;
  handleChannelConfigReload: () => Promise<void>;
  handleNostrProfileEdit: (accountId: string, profile: NostrProfile | null) => void;
  handleNostrProfileCancel: () => void;
  handleNostrProfileFieldChange: (field: keyof NostrProfile, value: string) => void;
  handleNostrProfileSave: () => Promise<void>;
  handleNostrProfileImport: () => Promise<void>;
  handleNostrProfileToggleAdvanced: () => void;
  handleExecApprovalDecision: (decision: "allow-once" | "allow-always" | "deny") => Promise<void>;
  handleGatewayUrlConfirm: () => void;
  handleGatewayUrlCancel: () => void;
  handleConfigLoad: () => Promise<void>;
  handleConfigSave: () => Promise<void>;
  handleConfigApply: () => Promise<void>;
  handleConfigFormUpdate: (path: string, value: unknown) => void;
  handleConfigFormModeChange: (mode: "form" | "raw") => void;
  handleConfigRawChange: (raw: string) => void;
  handleInstallSkill: (key: string) => Promise<void>;
  handleUpdateSkill: (key: string) => Promise<void>;
  handleToggleSkillEnabled: (key: string, enabled: boolean) => Promise<void>;
  handleUpdateSkillEdit: (key: string, value: string) => void;
  handleSaveSkillApiKey: (key: string, apiKey: string) => Promise<void>;
  handleCronToggle: (jobId: string, enabled: boolean) => Promise<void>;
  handleCronRun: (jobId: string) => Promise<void>;
  handleCronRemove: (jobId: string) => Promise<void>;
  handleCronAdd: () => Promise<void>;
  handleCronRunsLoad: (jobId: string) => Promise<void>;
  handleCronFormUpdate: (path: string, value: unknown) => void;
  handleSessionsLoad: () => Promise<void>;
  handleSessionsPatch: (key: string, patch: unknown) => Promise<void>;
  handleLoadNodes: () => Promise<void>;
  handleLoadPresence: () => Promise<void>;
  handleLoadSkills: () => Promise<void>;
  handleLoadDebug: () => Promise<void>;
  handleLoadLogs: () => Promise<void>;
  handleDebugCall: () => Promise<void>;
  handleRunUpdate: () => Promise<void>;
  setPassword: (next: string) => void;
  setSessionKey: (next: string) => void;
  setChatMessage: (next: string) => void;
  handleSendChat: (messageOverride?: string, opts?: { restoreDraft?: boolean }) => Promise<void>;
  handleAbortChat: () => Promise<void>;
  removeQueuedMessage: (id: string) => void;
  handleChatScroll: (event: Event) => void;
  resetToolStream: () => void;
  resetChatScroll: () => void;
  exportLogs: (lines: string[], label: string) => void;
  handleLogsScroll: (event: Event) => void;
  handleOpenSidebar: (content: string) => void;
  handleCloseSidebar: () => void;
  handleSplitRatioChange: (ratio: number) => void;
};
