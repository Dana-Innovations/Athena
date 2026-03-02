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

const EXECUTE_TIMEOUT_MS = 120_000;

export class CortexClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: CortexClientConfig) {
    this.baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    path: string,
    opts?: { method?: string; body?: unknown; timeoutMs?: number },
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
    return this.request<CortexTool[]>("/api/v1/tools/schemas");
  }

  /**
   * Execute a tool on the Cortex side and return the result.
   *
   * The Cortex server is responsible for routing to the appropriate MCP,
   * agent, or monitor and applying ABAC authorization.
   */
  async executeTool(req: CortexToolExecutionRequest): Promise<CortexToolExecutionResult> {
    return this.request<CortexToolExecutionResult>("/api/v1/tools/execute", {
      method: "POST",
      body: req,
      timeoutMs: EXECUTE_TIMEOUT_MS,
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
    logsQs.set("limit", String(params?.limit ?? 50));

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

    return {
      totalRequests: usage?.summary.totalRequests ?? 0,
      totalInputTokens: usage?.summary.totalInputTokens ?? 0,
      totalOutputTokens: usage?.summary.totalOutputTokens ?? 0,
      totalCost: usage?.summary.totalCostUsd ?? 0,
      keySourceBreakdown: breakdown,
      recentRequests,
    };
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
