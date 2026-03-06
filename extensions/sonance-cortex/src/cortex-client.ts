/**
 * Sonance Cortex API Client
 *
 * Handles communication with the Cortex platform for:
 *   - Tool discovery (MCPs, custom agents, monitors)
 *   - Tool execution proxy (forward tool calls to Cortex for remote execution)
 *   - Centralized API key resolution
 *   - Audit event push (billing/security telemetry)
 *   - Policy checks (ABAC tool authorization)
 */

export type CortexClientConfig = {
  apiBaseUrl: string;
  apiKey: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseJwtSecret?: string;
};

export type CortexTool = {
  name: string;
  description: string;
  /** JSON Schema for tool parameters. */
  parameters: Record<string, unknown>;
  /** Whether the tool requires explicit user approval before execution. */
  requiresApproval?: boolean;
};

export type CortexToolExecutionRequest = {
  toolName: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  /** Sonance user id for ABAC authorization on the Cortex side. */
  userId?: string;
  sessionKey?: string;
};

export type CortexToolExecutionResult = {
  ok: boolean;
  /** Structured or text output returned by the tool. */
  output?: unknown;
  /** Human-readable error if ok=false. */
  error?: string;
};

export type CortexAuditPayload = {
  events: Array<{
    userId?: string;
    sessionKey?: string;
    agentId?: string;
    toolName: string;
    toolCallId?: string;
    startedAt: number;
    durationMs?: number;
    success: boolean;
    error?: string;
    blocked?: boolean;
  }>;
};

// ── Key management types (Apollo Phase 2 multi-auth) ──────────────────

export type KeyConfig = {
  keyType: "api_key" | "oauth_token";
  /** Masked key value (e.g., "sk-ant-...xxxx") */
  maskedKey?: string;
  label?: string;
  isActive: boolean;
  lastVerifiedAt?: string;
  lastError?: string;
  expiresAt?: string;
};

export type KeyStatus = {
  activeSource: "user_key" | "user_oauth" | "org" | "none";
  sources?: Record<
    string,
    {
      available: boolean;
      label?: string;
      lastVerified?: string;
      lastError?: string;
      expiresAt?: string;
    }
  >;
};

export type VerifyResult = {
  valid: boolean;
  error?: string;
};

/** Raw shape returned by GET /api/v1/ai/usage from Cortex. */
type CortexUsageResponse = {
  summary: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
  };
  data: Array<{
    date?: string;
    model?: string;
    projectId?: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    keySource?: string;
  }>;
  limits: {
    monthlyTokenLimit?: number;
    monthlyTokensUsed: number;
    monthlySpendLimitUsd?: number;
    monthlySpendUsedUsd: number;
  };
};

/** Raw shape returned by GET /api/v1/ai/usage/logs from Cortex. */
type CortexUsageLogsResponse = {
  logs: Array<{
    id: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    latencyMs?: number;
    keySource?: string;
    consumerId?: string;
    userEmail?: string;
    userDisplayName?: string;
    createdAt: string;
  }>;
  hasMore: boolean;
  nextCursor?: string;
};

/** Per-user aggregate for the dashboard leaderboard. */
export type ApolloUserBreakdown = {
  userEmail: string;
  userDisplayName: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
};

// ── Cortex Skills types ──────────────────────────────────────────────

export type CortexSkillSummary = {
  name: string;
  display_name: string;
  description: string;
  category: string;
  mcp_name: string;
  rule_count: number;
  enabled: boolean;
};

export type CortexSkillListResponse = {
  skills: CortexSkillSummary[];
  total: number;
};

export type CortexSkillRule = {
  id: string;
  title: string;
  description: string;
  priority: string;
  correct_example: string | null;
  incorrect_example: string | null;
  applicable_tools: string[];
  metadata: Record<string, unknown>;
};

export type CortexSkillDefinition = {
  name: string;
  display_name: string;
  description: string;
  category: string;
  mcp_name: string;
  version: string;
  author: string | null;
  enabled_by_default: boolean;
  metadata: Record<string, unknown>;
};

export type CortexSkillDetailResponse = {
  definition: CortexSkillDefinition;
  rules: CortexSkillRule[];
  user_enabled: boolean;
  user_settings: Record<string, unknown>;
};

export type CortexSkillSettingsRequest = {
  enabled?: boolean;
  notify_advisories?: boolean;
  custom_settings?: Record<string, unknown>;
};

export type CortexSkillSettingsResponse = {
  skill_name: string;
  user_id: string;
  enabled: boolean;
  notify_advisories: boolean;
  custom_settings: Record<string, unknown>;
  updated_at: string;
};

export type CortexSkillsPromptResponse = {
  prompt: string;
  skill_count: number;
  rule_count: number;
};

/** Normalized shape that the Athena UI expects. */
export type ApolloUsageSummary = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  keySourceBreakdown: Record<string, { requests: number; cost: number }>;
  userBreakdown: ApolloUserBreakdown[];
  recentRequests: Array<{
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    keySource: string;
    consumerId?: string;
    userEmail?: string;
    userDisplayName?: string;
  }>;
};

/** Per-user aggregate from Supabase direct query. */
export type ApolloDashboardUser = {
  userId: string;
  email: string;
  displayName: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
};

/** Org-wide usage summary from the Supabase direct query. */
export type ApolloDashboardUsage = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  users: ApolloDashboardUser[];
};

const EXECUTE_TIMEOUT_MS = 120_000;

export class CortexClient {
  private baseUrl: string;
  private apiKey: string;
  private supabaseUrl: string;
  private supabaseServiceRoleKey: string;

  constructor(config: CortexClientConfig) {
    this.baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.supabaseUrl = (config.supabaseUrl ?? "").replace(/\/+$/, "");
    this.supabaseServiceRoleKey = config.supabaseServiceRoleKey ?? "";
  }

  private async request<T>(
    path: string,
    opts?: {
      method?: string;
      body?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = opts?.timeoutMs
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;

    try {
      const res = await fetch(url, {
        method: opts?.method ?? "GET",
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
          ...opts?.headers,
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Cortex API error: ${res.status} ${res.statusText} — ${text}`);
      }
      return (await res.json()) as T;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /** Discover available tools for the current gateway/tenant. */
  async listTools(): Promise<CortexTool[]> {
    const res = await this.request<{
      tools: Array<{
        name: string;
        description: string;
        input_schema?: { properties?: Record<string, unknown> };
        requiresApproval?: boolean;
      }>;
    }>("/api/v1/tools/schemas");
    return (res.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema?.properties ?? {},
      requiresApproval: t.requiresApproval,
    }));
  }

  /**
   * Execute a tool on the Cortex side and return the result.
   *
   * The Cortex server is responsible for routing to the appropriate MCP,
   * agent, or monitor and applying ABAC authorization.
   */
  async executeTool(
    req: CortexToolExecutionRequest,
    opts?: { userId?: string },
  ): Promise<CortexToolExecutionResult> {
    const headers: Record<string, string> = {};
    if (opts?.userId) {
      headers["X-Cortex-User-Id"] = opts.userId;
    }
    return this.request<CortexToolExecutionResult>("/api/v1/tools/execute", {
      method: "POST",
      body: req,
      timeoutMs: EXECUTE_TIMEOUT_MS,
      headers,
    });
  }

  /** Push audit events for billing and security monitoring. */
  async pushAuditEvents(payload: CortexAuditPayload): Promise<void> {
    await this.request("/api/v1/audit/events", {
      method: "POST",
      body: payload,
    });
  }

  /** Health check — returns true if the Cortex API is reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>("/health");
      return true;
    } catch {
      return false;
    }
  }

  // ── Key management (Apollo Phase 2) ─────────────────────────────────

  /** List key configurations (masked values). */
  async listKeys(): Promise<KeyConfig[]> {
    return this.request<KeyConfig[]>("/api/v1/ai/keys");
  }

  /** Set user's own Anthropic API key. */
  async setApiKey(key: string, label?: string): Promise<void> {
    await this.request("/api/v1/ai/keys/api-key", {
      method: "PUT",
      body: { apiKey: key, label },
    });
  }

  /** Remove user's Anthropic API key. */
  async removeApiKey(): Promise<void> {
    await this.request("/api/v1/ai/keys/api-key", { method: "DELETE" });
  }

  /** Verify the stored API key against Anthropic. */
  async verifyApiKey(): Promise<VerifyResult> {
    return this.request<VerifyResult>("/api/v1/ai/keys/api-key/verify", {
      method: "POST",
    });
  }

  /** Get the current active key source and details. */
  async getKeyStatus(): Promise<KeyStatus> {
    return this.request<KeyStatus>("/api/v1/ai/keys/status");
  }

  /** Start Anthropic OAuth flow; returns the authorization URL. */
  async startOAuthFlow(): Promise<{ authorizeUrl: string }> {
    return this.request<{ authorizeUrl: string }>("/api/v1/ai/keys/oauth/authorize");
  }

  /** Disconnect Anthropic OAuth token. */
  async disconnectOAuth(): Promise<void> {
    await this.request("/api/v1/ai/keys/oauth", { method: "DELETE" });
  }

  // ── Apollo usage (dashboard) ────────────────────────────────────────

  /** Fetch Apollo usage summary for the dashboard.
   *
   * Combines GET /api/v1/ai/usage (summary + aggregates) and
   * GET /api/v1/ai/usage/logs (recent individual requests) into the
   * normalized ApolloUsageSummary shape the UI expects.
   */
  async getApolloUsage(params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<ApolloUsageSummary> {
    const qs = new URLSearchParams();
    if (params?.startDate) qs.set("start_date", params.startDate);
    if (params?.endDate) qs.set("end_date", params.endDate);

    const logsQs = new URLSearchParams(qs);
    logsQs.set("limit", String(Math.min(params?.limit ?? 100, 100)));

    const query = qs.toString();
    const logsQuery = logsQs.toString();

    const [usageRes, logsRes] = await Promise.allSettled([
      this.request<CortexUsageResponse>(`/api/v1/ai/usage${query ? `?${query}` : ""}`),
      this.request<CortexUsageLogsResponse>(
        `/api/v1/ai/usage/logs${logsQuery ? `?${logsQuery}` : ""}`,
      ),
    ]);

    const usage = usageRes.status === "fulfilled" ? usageRes.value : null;
    const logs = logsRes.status === "fulfilled" ? logsRes.value : null;

    // Build key-source breakdown from grouped data
    const breakdown: Record<string, { requests: number; cost: number }> = {};
    if (usage?.data) {
      for (const row of usage.data) {
        const src = row.keySource ?? "org";
        const entry = breakdown[src] ?? { requests: 0, cost: 0 };
        entry.requests += row.requests;
        entry.cost += row.costUsd;
        breakdown[src] = entry;
      }
    }

    // Map log entries to the UI's recentRequests shape
    const recentRequests = (logs?.logs ?? []).map((log) => ({
      timestamp: log.createdAt,
      model: log.model,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      cost: log.costUsd,
      keySource: log.keySource ?? "org",
      consumerId: log.consumerId,
      userEmail: log.userEmail,
      userDisplayName: log.userDisplayName,
    }));

    // Build per-user breakdown from logs
    const userMap = new Map<
      string,
      {
        displayName: string | null;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cost: number;
      }
    >();
    for (const log of logs?.logs ?? []) {
      const email = log.userEmail ?? "unknown";
      const entry = userMap.get(email) ?? {
        displayName: log.userDisplayName ?? null,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
      };
      entry.requests += 1;
      entry.inputTokens += log.inputTokens;
      entry.outputTokens += log.outputTokens;
      entry.totalTokens += log.totalTokens;
      entry.cost += log.costUsd;
      if (log.userDisplayName && !entry.displayName) {
        entry.displayName = log.userDisplayName;
      }
      userMap.set(email, entry);
    }

    const userBreakdown: ApolloUserBreakdown[] = [...userMap.entries()].map(([email, data]) => ({
      userEmail: email,
      userDisplayName: data.displayName,
      requests: data.requests,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.totalTokens,
      cost: data.cost,
    }));

    return {
      totalRequests: usage?.summary.totalRequests ?? 0,
      totalInputTokens: usage?.summary.totalInputTokens ?? 0,
      totalOutputTokens: usage?.summary.totalOutputTokens ?? 0,
      totalCost: usage?.summary.totalCostUsd ?? 0,
      keySourceBreakdown: breakdown,
      userBreakdown,
      recentRequests,
    };
  }

  // ── Dashboard (org-wide) usage via Supabase direct query ─────────────

  /**
   * Fetch org-wide usage by querying Supabase's ai_usage_logs table directly
   * with the service-role key (bypasses RLS). Aggregates by user and joins
   * with Supabase auth.users for display names / emails.
   */
  async getOrgWideUsage(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<ApolloDashboardUsage> {
    if (!this.supabaseUrl || !this.supabaseServiceRoleKey) {
      throw new Error("Supabase credentials not configured for org-wide usage");
    }

    const headers = {
      Authorization: `Bearer ${this.supabaseServiceRoleKey}`,
      apikey: this.supabaseServiceRoleKey,
    };

    // Build PostgREST filter for date range
    const filters: string[] = [];
    if (params?.startDate) filters.push(`created_at=gte.${params.startDate}T00:00:00Z`);
    if (params?.endDate) filters.push(`created_at=lte.${params.endDate}T23:59:59Z`);
    const filterStr = filters.length ? `&${filters.join("&")}` : "";

    // Fetch usage logs in pages (PostgREST default limit is 1000)
    type UsageRow = {
      user_id: string;
      total_cost_microdollars: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
      model: string | null;
    };

    const allRows: UsageRow[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const url =
        `${this.supabaseUrl}/rest/v1/ai_usage_logs` +
        `?select=user_id,total_cost_microdollars,input_tokens,output_tokens,model` +
        `&order=created_at${filterStr}&offset=${offset}&limit=${pageSize}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Supabase query failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
      const page = (await res.json()) as UsageRow[];
      allRows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    // Fetch user directory for display names
    type SupabaseUser = {
      id: string;
      email?: string;
      user_metadata?: { full_name?: string; name?: string; display_name?: string };
    };

    let userDirectory = new Map<string, { email: string; displayName: string | null }>();
    try {
      const usersRes = await fetch(`${this.supabaseUrl}/auth/v1/admin/users`, { headers });
      if (usersRes.ok) {
        const usersData = (await usersRes.json()) as { users?: SupabaseUser[] } | SupabaseUser[];
        const users = Array.isArray(usersData) ? usersData : (usersData.users ?? []);
        for (const u of users) {
          const meta = u.user_metadata ?? {};
          const displayName = meta.full_name ?? meta.name ?? meta.display_name ?? null;
          userDirectory.set(u.id, { email: u.email ?? "unknown", displayName });
        }
      }
    } catch {
      // Non-fatal; user info will show as IDs
    }

    // Aggregate by user_id
    const userAgg = new Map<
      string,
      { requests: number; costMicro: number; inputTokens: number; outputTokens: number }
    >();
    for (const row of allRows) {
      const uid = row.user_id ?? "unknown";
      const entry = userAgg.get(uid) ?? {
        requests: 0,
        costMicro: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      entry.requests += 1;
      entry.costMicro += row.total_cost_microdollars ?? 0;
      entry.inputTokens += row.input_tokens ?? 0;
      entry.outputTokens += row.output_tokens ?? 0;
      userAgg.set(uid, entry);
    }

    let totalRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    const users: ApolloDashboardUser[] = [];
    for (const [uid, agg] of userAgg) {
      const cost = agg.costMicro / 1_000_000;
      const info = userDirectory.get(uid);
      totalRequests += agg.requests;
      totalInputTokens += agg.inputTokens;
      totalOutputTokens += agg.outputTokens;
      totalCost += cost;
      users.push({
        userId: uid,
        email: info?.email ?? uid,
        displayName: info?.displayName ?? null,
        requests: agg.requests,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        totalTokens: agg.inputTokens + agg.outputTokens,
        cost,
      });
    }

    // Sort by cost descending
    users.sort((a, b) => b.cost - a.cost);

    return { totalRequests, totalInputTokens, totalOutputTokens, totalCost, users };
  }

  // ── Skills (Praxis) ─────────────────────────────────────────────────

  /** List all Cortex skills with optional filtering. */
  async listSkills(params?: {
    category?: string;
    mcp?: string;
    enabledOnly?: boolean;
  }): Promise<CortexSkillListResponse> {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.mcp) qs.set("mcp", params.mcp);
    if (params?.enabledOnly) qs.set("enabled_only", "true");
    const query = qs.toString();
    return this.request<CortexSkillListResponse>(`/api/v1/skills${query ? `?${query}` : ""}`);
  }

  /** Get detailed info for a single Cortex skill including rules. */
  async getSkillDetail(skillName: string): Promise<CortexSkillDetailResponse> {
    return this.request<CortexSkillDetailResponse>(
      `/api/v1/skills/${encodeURIComponent(skillName)}`,
    );
  }

  /** Update user-specific settings for a Cortex skill. */
  async updateSkillSettings(
    skillName: string,
    settings: CortexSkillSettingsRequest,
  ): Promise<CortexSkillSettingsResponse> {
    return this.request<CortexSkillSettingsResponse>(
      `/api/v1/skills/${encodeURIComponent(skillName)}/settings`,
      { method: "PUT", body: settings },
    );
  }

  // ── Admin (read-only visibility) ──────────────────────────────────────

  /** Get the current user's profile (including role) from cortex_users. */
  async getUserProfile(email: string): Promise<{
    user_id: string;
    email: string;
    full_name: string | null;
    role: string;
    status: string;
    department?: string;
    job_title?: string;
    mcp_access?: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/auth/me?user_email=${encodeURIComponent(email)}`);
  }

  /** List all users (admin-only). */
  async listUsers(): Promise<{
    users: Array<{
      id: string;
      email: string;
      full_name: string | null;
      department: string | null;
      job_title: string | null;
      role: string;
      status: string;
      mcp_access: Record<string, unknown> | null;
      last_active_at: string | null;
      created_at: string;
    }>;
    total: number;
  }> {
    return this.request("/api/v1/admin/users");
  }

  /** Get cross-user usage summary (admin-only). */
  async getAdminUsage(params?: { startDate?: string; endDate?: string; limit?: number }): Promise<{
    summary: {
      totalRequests: number;
      totalTokens: number;
      totalCostUsd: number;
      userBreakdown: Array<{
        userId: string;
        email: string;
        displayName: string | null;
        totalRequests: number;
        totalTokens: number;
        totalCostUsd: number;
        lastRequestAt: string | null;
      }>;
      modelBreakdown: Array<{
        model: string;
        requests: number;
        tokens: number;
        costUsd: number;
      }>;
      dailyTotals: Array<{
        date: string;
        requests: number;
        tokens: number;
        costUsd: number;
      }>;
    };
    details: Array<{
      id: string;
      userId: string;
      email: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      keySource: string;
      createdAt: string;
    }>;
  }> {
    const qs = new URLSearchParams();
    if (params?.startDate) qs.set("start_date", params.startDate);
    if (params?.endDate) qs.set("end_date", params.endDate);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return this.request(`/api/v1/admin/usage${query ? `?${query}` : ""}`);
  }

  /** Get MCP access matrix (admin-only). */
  async getAdminMcpAccess(): Promise<{
    mcps: Array<{
      name: string;
      displayName: string;
      toolCount: number;
      description: string;
    }>;
    userAccess: Array<{
      userId: string;
      email: string;
      displayName: string | null;
      mcpAccess: Record<string, { enabled: boolean; connectedAt?: string }>;
      connectionStatus: string;
    }>;
  }> {
    return this.request("/api/v1/admin/mcp-access");
  }

  /** Get Supabase project access matrix (admin-only). */
  async getAdminProjectAccess(): Promise<{
    projects: Array<{
      project_ref: string;
      project_name: string | null;
      user_count: number;
      grants: Array<{
        id: string;
        user_id: string;
        email: string;
        display_name: string | null;
        project_ref: string;
        project_name: string | null;
        grant_source: string;
        granted_by: string | null;
        created_at: string | null;
        expires_at: string | null;
      }>;
    }>;
    total_grants: number;
  }> {
    return this.request("/api/v1/admin/project-access");
  }

  /** Grant a user access to a Supabase project (admin-only). */
  async grantProjectAccess(params: {
    user_id: string;
    project_ref: string;
    project_name?: string;
  }): Promise<{ ok: boolean; message: string }> {
    return this.request("/api/v1/admin/project-access/grant", {
      method: "POST",
      body: params,
    });
  }

  /** Revoke a user's access to a Supabase project (admin-only). */
  async revokeProjectAccess(params: {
    user_id: string;
    project_ref: string;
  }): Promise<{ ok: boolean; message: string }> {
    return this.request(
      `/api/v1/admin/project-access/revoke?user_id=${encodeURIComponent(params.user_id)}&project_ref=${encodeURIComponent(params.project_ref)}`,
      { method: "DELETE" },
    );
  }

  /** Revoke all Supabase project access for a user (admin-only). */
  async revokeAllProjectAccess(params: {
    user_id: string;
  }): Promise<{ ok: boolean; message: string }> {
    return this.request(
      `/api/v1/admin/project-access/revoke-all?user_id=${encodeURIComponent(params.user_id)}`,
      { method: "DELETE" },
    );
  }

  /** Grant a user access to all known Supabase projects (admin-only). */
  async grantAllProjectAccess(params: {
    user_id: string;
  }): Promise<{ ok: boolean; message: string }> {
    return this.request("/api/v1/admin/project-access/grant-all", {
      method: "POST",
      body: params,
    });
  }

  /** Fetch the LLM-ready skills prompt for system prompt injection. */
  async getSkillsPrompt(params?: {
    minPriority?: string;
    maxRulesPerSkill?: number;
    includeExamples?: boolean;
  }): Promise<CortexSkillsPromptResponse> {
    const qs = new URLSearchParams();
    if (params?.minPriority) qs.set("min_priority", params.minPriority);
    if (params?.maxRulesPerSkill != null)
      qs.set("max_rules_per_skill", String(params.maxRulesPerSkill));
    if (params?.includeExamples != null) qs.set("include_examples", String(params.includeExamples));
    const query = qs.toString();
    return this.request<CortexSkillsPromptResponse>(
      `/api/v1/skills/prompt${query ? `?${query}` : ""}`,
    );
  }
}
