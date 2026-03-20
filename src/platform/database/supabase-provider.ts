import { randomUUID } from "node:crypto";
/**
 * Supabase (PostgREST) provider for the Athena platform database.
 * Uses native fetch — no @supabase/supabase-js dependency.
 * Intended for production deployments.
 */
import type {
  AgentHealthFilter,
  AgentHealthSample,
  AgentStats,
  AthenaDatabase,
  AuditEvent,
  AuditFilter,
  Conversation,
  ConversationFilter,
  CronJob,
  CronRun,
  ErrorEvent,
  ErrorEventFilter,
  MemoryEntry,
  MemoryFilter,
  Message,
  MessageFilter,
  MetricsFilter,
  PlatformStats,
  SoulVersion,
  UsageMetric,
} from "./types.js";

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

export class AthenaSupabaseProvider implements AthenaDatabase {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: SupabaseConfig) {
    this.baseUrl = `${config.url.replace(/\/$/, "")}/rest/v1`;
    this.headers = {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }

  async initSchema(): Promise<void> {
    // Schema managed via Supabase migrations — no-op at runtime.
  }

  // -- Conversations --------------------------------------------------------

  async createConversation(params: {
    agentId: string;
    userId: string;
    userEmail?: string;
    gateway: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.post("agent_conversations", {
      id,
      agent_id: params.agentId,
      user_id: params.userId,
      user_email: params.userEmail ?? null,
      gateway: params.gateway,
      started_at: now,
      last_message_at: now,
      metadata: params.metadata ?? {},
      token_usage: { input: 0, output: 0 },
      created_at: now,
    });
    return id;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const rows = await this.get<RawConversation[]>("agent_conversations", { id: `eq.${id}` });
    return rows.length > 0 ? mapConversation(rows[0]) : null;
  }

  async listConversations(filter?: ConversationFilter): Promise<Conversation[]> {
    const q: Record<string, string> = {
      order: "last_message_at.desc",
      limit: String(filter?.limit ?? 50),
      offset: String(filter?.offset ?? 0),
    };
    if (filter?.agentId) {
      q.agent_id = `eq.${filter.agentId}`;
    }
    if (filter?.userId) {
      q.user_id = `eq.${filter.userId}`;
    }
    if (filter?.gateway) {
      q.gateway = `eq.${filter.gateway}`;
    }
    if (filter?.since) {
      q.last_message_at = `gte.${filter.since}`;
    }
    if (filter?.until) {
      q.last_message_at = q.last_message_at
        ? `and(gte.${filter.since},lte.${filter.until})`
        : `lte.${filter.until}`;
    }

    const rows = await this.get<RawConversation[]>("agent_conversations", q);
    return rows.map(mapConversation);
  }

  async updateConversationTokens(
    id: string,
    tokens: { input: number; output: number },
  ): Promise<void> {
    const existing = await this.getConversation(id);
    if (!existing) {
      return;
    }
    const updated = {
      input: existing.tokenUsage.input + tokens.input,
      output: existing.tokenUsage.output + tokens.output,
    };
    await this.patch("agent_conversations", { id: `eq.${id}` }, { token_usage: updated });
  }

  // -- Messages -------------------------------------------------------------

  async addMessage(params: {
    conversationId: string;
    agentId: string;
    userId: string;
    role: string;
    content: string;
    toolCalls?: unknown[];
    tokenCount?: number;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.post("agent_messages", {
      id,
      conversation_id: params.conversationId,
      agent_id: params.agentId,
      user_id: params.userId,
      role: params.role,
      content: params.content,
      tool_calls: params.toolCalls ?? null,
      token_count: params.tokenCount ?? null,
      created_at: now,
    });
    await this.rpc("increment_conversation_messages", {
      conv_id: params.conversationId,
      ts: now,
    }).catch(() => {
      // Fallback: manual update if RPC not available
      return this.patch(
        "agent_conversations",
        { id: `eq.${params.conversationId}` },
        { last_message_at: now },
      );
    });
    return id;
  }

  async getMessages(filter: MessageFilter): Promise<Message[]> {
    const q: Record<string, string> = {
      conversation_id: `eq.${filter.conversationId}`,
      order: "created_at.asc",
      limit: String(filter.limit ?? 200),
      offset: String(filter.offset ?? 0),
    };
    if (filter.role) {
      q.role = `eq.${filter.role}`;
    }

    const rows = await this.get<RawMessage[]>("agent_messages", q);
    return rows.map(mapMessage);
  }

  async searchMessages(
    query: string,
    opts?: { limit?: number; offset?: number; agentId?: string },
  ): Promise<Message[]> {
    const q: Record<string, string> = {
      content: `ilike.*${query}*`,
      order: "created_at.desc",
      limit: String(opts?.limit ?? 50),
      offset: String(opts?.offset ?? 0),
    };
    if (opts?.agentId) {
      q.agent_id = `eq.${opts.agentId}`;
    }

    const rows = await this.get<RawMessage[]>("agent_messages", q);
    return rows.map(mapMessage);
  }

  // -- Memory ---------------------------------------------------------------

  async upsertMemory(params: {
    agentId: string;
    userId: string;
    category: string;
    topic: string;
    content: string;
    confidence?: number;
    source?: string;
    expiresAt?: string;
  }): Promise<string> {
    const now = new Date().toISOString();
    const existing = await this.get<Array<{ id: string }>>("agent_memory", {
      agent_id: `eq.${params.agentId}`,
      user_id: `eq.${params.userId}`,
      topic: `eq.${params.topic}`,
      select: "id",
      limit: "1",
    });

    if (existing.length > 0) {
      await this.patch(
        "agent_memory",
        { id: `eq.${existing[0].id}` },
        {
          content: params.content,
          category: params.category,
          confidence: params.confidence ?? 1.0,
          source: params.source ?? null,
          expires_at: params.expiresAt ?? null,
          updated_at: now,
        },
      );
      return existing[0].id;
    }

    const id = randomUUID();
    await this.post("agent_memory", {
      id,
      agent_id: params.agentId,
      user_id: params.userId,
      category: params.category,
      topic: params.topic,
      content: params.content,
      confidence: params.confidence ?? 1.0,
      source: params.source ?? null,
      expires_at: params.expiresAt ?? null,
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  async getMemory(filter: MemoryFilter): Promise<MemoryEntry[]> {
    const q: Record<string, string> = {
      order: "updated_at.desc",
      limit: String(filter.limit ?? 100),
      offset: String(filter.offset ?? 0),
    };
    if (filter.agentId) {
      q.agent_id = `eq.${filter.agentId}`;
    }
    if (filter.userId) {
      q.user_id = `eq.${filter.userId}`;
    }
    if (filter.category) {
      q.category = `eq.${filter.category}`;
    }
    if (filter.search) {
      q.or = `(content.ilike.*${filter.search}*,topic.ilike.*${filter.search}*)`;
    }

    const rows = await this.get<RawMemoryEntry[]>("agent_memory", q);
    return rows.map(mapMemoryEntry);
  }

  async deleteMemory(id: string): Promise<void> {
    await this.del("agent_memory", { id: `eq.${id}` });
  }

  // -- Usage Metrics --------------------------------------------------------

  async recordUsage(params: {
    agentId: string;
    date: string;
    conversations?: number;
    messages?: number;
    toolCalls?: number;
    tokensInput?: number;
    tokensOutput?: number;
    errors?: number;
    uniqueUsers?: number;
    avgLatencyMs?: number;
  }): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.get<Array<{ id: string }>>("usage_metrics", {
      agent_id: `eq.${params.agentId}`,
      date: `eq.${params.date}`,
      select: "id",
      limit: "1",
    });

    if (existing.length > 0) {
      await this.rpc("increment_usage_metrics", {
        metric_id: existing[0].id,
        add_conversations: params.conversations ?? 0,
        add_messages: params.messages ?? 0,
        add_tool_calls: params.toolCalls ?? 0,
        add_tokens_input: params.tokensInput ?? 0,
        add_tokens_output: params.tokensOutput ?? 0,
        add_errors: params.errors ?? 0,
      }).catch(() => {
        // Fallback: overwrite if RPC not available
        return this.patch("usage_metrics", { id: `eq.${existing[0].id}` }, {});
      });
    } else {
      await this.post("usage_metrics", {
        id: randomUUID(),
        agent_id: params.agentId,
        date: params.date,
        conversations: params.conversations ?? 0,
        messages: params.messages ?? 0,
        tool_calls: params.toolCalls ?? 0,
        tokens_input: params.tokensInput ?? 0,
        tokens_output: params.tokensOutput ?? 0,
        errors: params.errors ?? 0,
        unique_users: params.uniqueUsers ?? 0,
        avg_latency_ms: params.avgLatencyMs ?? null,
        created_at: now,
      });
    }
  }

  async getMetrics(filter?: MetricsFilter): Promise<UsageMetric[]> {
    const q: Record<string, string> = { order: "date.desc" };
    if (filter?.agentId) {
      q.agent_id = `eq.${filter.agentId}`;
    }
    if (filter?.since) {
      q.date = `gte.${filter.since}`;
    }
    if (filter?.until) {
      q.date = q.date ? `and(gte.${filter.since},lte.${filter.until})` : `lte.${filter.until}`;
    }

    const rows = await this.get<RawUsageMetric[]>("usage_metrics", q);
    return rows.map(mapUsageMetric);
  }

  async getAgentStats(_agentId?: string): Promise<AgentStats[]> {
    const q: Record<string, string> = {
      select:
        "agent_id,conversations,messages,tool_calls,tokens_input,tokens_output,errors,unique_users,date",
      order: "date.desc",
    };
    if (_agentId) {
      q.agent_id = `eq.${_agentId}`;
    }

    const rows = await this.get<RawUsageMetric[]>("usage_metrics", q);
    const byAgent = new Map<string, AgentStats>();
    for (const r of rows) {
      const existing = byAgent.get(r.agent_id);
      if (existing) {
        existing.conversations += r.conversations ?? 0;
        existing.messages += r.messages ?? 0;
        existing.tokensInput += r.tokens_input ?? 0;
        existing.tokensOutput += r.tokens_output ?? 0;
        existing.errors += r.errors ?? 0;
        if (r.unique_users > (existing.uniqueUsers ?? 0)) {
          existing.uniqueUsers = r.unique_users;
        }
      } else {
        byAgent.set(r.agent_id, {
          agentId: r.agent_id,
          conversations: r.conversations ?? 0,
          messages: r.messages ?? 0,
          uniqueUsers: r.unique_users ?? 0,
          tokensInput: r.tokens_input ?? 0,
          tokensOutput: r.tokens_output ?? 0,
          errors: r.errors ?? 0,
          lastActivityAt: r.date,
          avgTurnDurationMs: null,
        });
      }
    }

    // Fetch avg turn duration from agent_health per agent
    const agentIds = Array.from(byAgent.keys());
    for (const agentId of agentIds) {
      const hq: Record<string, string> = {
        agent_id: `eq.${agentId}`,
        select: "turn_duration_ms",
        limit: "500",
      };
      const health = await this.get<Array<{ turn_duration_ms: number }>>("agent_health", hq).catch(
        () => [],
      );
      if (health.length > 0) {
        const avg = health.reduce((sum, h) => sum + (h.turn_duration_ms ?? 0), 0) / health.length;
        const stat = byAgent.get(agentId);
        if (stat) {
          stat.avgTurnDurationMs = Math.round(avg);
        }
      }
    }

    return Array.from(byAgent.values());
  }

  // -- Cron -----------------------------------------------------------------

  async upsertCronJob(params: {
    agentId: string;
    name: string;
    schedule: string;
    action: string;
    enabled?: boolean;
  }): Promise<string> {
    const now = new Date().toISOString();
    const existing = await this.get<Array<{ id: string }>>("cron_jobs", {
      agent_id: `eq.${params.agentId}`,
      name: `eq.${params.name}`,
      select: "id",
      limit: "1",
    });

    if (existing.length > 0) {
      await this.patch(
        "cron_jobs",
        { id: `eq.${existing[0].id}` },
        { schedule: params.schedule, action: params.action, enabled: params.enabled !== false },
      );
      return existing[0].id;
    }

    const id = randomUUID();
    await this.post("cron_jobs", {
      id,
      agent_id: params.agentId,
      name: params.name,
      schedule: params.schedule,
      action: params.action,
      enabled: true,
      created_at: now,
    });
    return id;
  }

  async listCronJobs(agentId?: string): Promise<CronJob[]> {
    const q: Record<string, string> = { order: "agent_id,name" };
    if (agentId) {
      q.agent_id = `eq.${agentId}`;
    }
    const rows = await this.get<RawCronJob[]>("cron_jobs", q);
    return rows.map(mapCronJob);
  }

  async recordCronRun(params: {
    jobId: string;
    status: string;
    result?: unknown;
    error?: string;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.post("cron_runs", {
      id,
      job_id: params.jobId,
      started_at: now,
      status: params.status,
      result: params.result ?? null,
      error: params.error ?? null,
    });
    if (params.status !== "running") {
      await this.patch("cron_jobs", { id: `eq.${params.jobId}` }, { last_run_at: now });
    }
    return id;
  }

  async getCronRuns(jobId: string, limit = 20): Promise<CronRun[]> {
    const rows = await this.get<RawCronRun[]>("cron_runs", {
      job_id: `eq.${jobId}`,
      order: "started_at.desc",
      limit: String(limit),
    });
    return rows.map(mapCronRun);
  }

  // -- Audit ----------------------------------------------------------------

  async logAudit(params: {
    eventType: string;
    agentId?: string;
    userId?: string;
    action: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.post("audit_events", {
      id,
      event_type: params.eventType,
      agent_id: params.agentId ?? null,
      user_id: params.userId ?? null,
      action: params.action,
      details: params.details ?? null,
      ip_address: params.ipAddress ?? null,
      created_at: now,
    });
    return id;
  }

  async getAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]> {
    const q: Record<string, string> = {
      order: "created_at.desc",
      limit: String(filter?.limit ?? 100),
      offset: String(filter?.offset ?? 0),
    };
    if (filter?.agentId) {
      q.agent_id = `eq.${filter.agentId}`;
    }
    if (filter?.userId) {
      q.user_id = `eq.${filter.userId}`;
    }
    if (filter?.eventType) {
      q.event_type = `eq.${filter.eventType}`;
    }
    if (filter?.since) {
      q.created_at = `gte.${filter.since}`;
    }
    if (filter?.until) {
      q.created_at = q.created_at
        ? `and(gte.${filter.since},lte.${filter.until})`
        : `lte.${filter.until}`;
    }

    const rows = await this.get<RawAuditEvent[]>("audit_events", q);
    return rows.map(mapAuditEvent);
  }

  // -- Error Events ---------------------------------------------------------

  async logErrorEvent(params: {
    agentId: string;
    conversationId?: string;
    userId?: string;
    errorType: "tool_error" | "api_error" | "runtime_error";
    errorMessage?: string;
    toolName?: string;
    details?: Record<string, unknown>;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.post("agent_error_events", {
      id,
      agent_id: params.agentId,
      conversation_id: params.conversationId ?? null,
      user_id: params.userId ?? null,
      error_type: params.errorType,
      error_message: params.errorMessage ?? null,
      tool_name: params.toolName ?? null,
      details: params.details ?? null,
      created_at: now,
    });
    return id;
  }

  async getErrorEvents(filter?: ErrorEventFilter): Promise<ErrorEvent[]> {
    const q: Record<string, string> = {
      order: "created_at.desc",
      limit: String(filter?.limit ?? 100),
      offset: String(filter?.offset ?? 0),
    };
    if (filter?.agentId) {
      q.agent_id = `eq.${filter.agentId}`;
    }
    if (filter?.conversationId) {
      q.conversation_id = `eq.${filter.conversationId}`;
    }
    if (filter?.since) {
      q.created_at = `gte.${filter.since}`;
    }
    if (filter?.until) {
      q.created_at = q.created_at
        ? `and(gte.${filter.since},lte.${filter.until})`
        : `lte.${filter.until}`;
    }

    const rows = await this.get<RawErrorEvent[]>("agent_error_events", q);
    return rows.map(mapErrorEvent);
  }

  // -- Health / Latency -----------------------------------------------------

  async logHealthSample(params: {
    agentId: string;
    conversationId?: string;
    userId?: string;
    turnDurationMs: number;
    responseLatencyMs?: number;
    status: "success" | "error" | "timeout";
    errorCode?: string;
    tokensInput?: number;
    tokensOutput?: number;
    model?: string;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.post("agent_health", {
      id,
      agent_id: params.agentId,
      conversation_id: params.conversationId ?? null,
      user_id: params.userId ?? null,
      turn_duration_ms: params.turnDurationMs,
      response_latency_ms: params.responseLatencyMs ?? null,
      status: params.status,
      error_code: params.errorCode ?? null,
      tokens_input: params.tokensInput ?? null,
      tokens_output: params.tokensOutput ?? null,
      model: params.model ?? null,
      created_at: now,
    });
    return id;
  }

  async getHealthSamples(filter?: AgentHealthFilter): Promise<AgentHealthSample[]> {
    const q: Record<string, string> = {
      order: "created_at.desc",
      limit: String(filter?.limit ?? 100),
      offset: String(filter?.offset ?? 0),
    };
    if (filter?.agentId) {
      q.agent_id = `eq.${filter.agentId}`;
    }
    if (filter?.status) {
      q.status = `eq.${filter.status}`;
    }
    if (filter?.since) {
      q.created_at = `gte.${filter.since}`;
    }
    if (filter?.until) {
      q.created_at = q.created_at
        ? `and(gte.${filter.since},lte.${filter.until})`
        : `lte.${filter.until}`;
    }

    const rows = await this.get<RawHealthSample[]>("agent_health", q);
    return rows.map(mapHealthSample);
  }

  // -- Aggregates -----------------------------------------------------------

  async getPlatformStats(): Promise<PlatformStats> {
    const today = new Date().toISOString().slice(0, 10);

    const [convs, msgs, mem, active, errors] = await Promise.all([
      this.get<Array<{ count: number }>>("agent_conversations", {
        select: "count",
        limit: "1",
      }).then((r) => r[0]?.count ?? 0),
      this.get<Array<{ count: number }>>("agent_messages", {
        select: "count",
        limit: "1",
      }).then((r) => r[0]?.count ?? 0),
      this.get<Array<{ count: number }>>("agent_memory", {
        select: "count",
        limit: "1",
      }).then((r) => r[0]?.count ?? 0),
      this.get<RawConversation[]>("agent_conversations", {
        last_message_at: `gte.${today}T00:00:00`,
        select: "user_id",
      }).then((r) => new Set(r.map((c) => c.user_id)).size),
      this.get<RawUsageMetric[]>("usage_metrics", {
        date: `eq.${today}`,
        select: "errors",
      }).then((r) => r.reduce((sum, m) => sum + (m.errors ?? 0), 0)),
    ]);

    const agentCount = await this.get<RawConversation[]>("agent_conversations", {
      select: "agent_id",
    }).then((r) => new Set(r.map((c) => c.agent_id)).size);

    return {
      agents: agentCount,
      conversations: convs,
      messages: msgs,
      memoryEntries: mem,
      activeUsersToday: active,
      errorsToday: errors,
    };
  }

  async getTableStats(): Promise<Record<string, number>> {
    const tables = [
      "agent_conversations",
      "agent_messages",
      "agent_memory",
      "usage_metrics",
      "cron_jobs",
      "cron_runs",
      "audit_events",
    ];
    const stats: Record<string, number> = {};
    for (const table of tables) {
      const rows = await this.get<Array<{ count: number }>>(table, {
        select: "count",
        limit: "1",
      });
      stats[table] = rows[0]?.count ?? 0;
    }
    return stats;
  }

  // -- Soul Versions --------------------------------------------------------

  async saveSoulVersion(params: {
    agentId: string;
    content: string;
    createdBy?: string;
    keepCount?: number;
  }): Promise<number> {
    const keep = params.keepCount ?? 10;
    // Get current max version
    const existing = await this.get<{ version: number }[]>("agent_soul_versions", {
      agent_id: `eq.${params.agentId}`,
      select: "version",
      order: "version.desc",
      limit: "1",
    });
    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.post("agent_soul_versions", {
      id,
      agent_id: params.agentId,
      version: nextVersion,
      content: params.content,
      created_by: params.createdBy ?? null,
      created_at: now,
    });
    // Prune oldest beyond keepCount
    if (nextVersion > keep) {
      const pruneBelow = nextVersion - keep;
      await this.del("agent_soul_versions", {
        agent_id: `eq.${params.agentId}`,
        version: `lte.${pruneBelow}`,
      });
    }
    return nextVersion;
  }

  async listSoulVersions(agentId: string): Promise<{ version: number; createdAt: string }[]> {
    const rows = await this.get<{ version: number; created_at: string }[]>("agent_soul_versions", {
      agent_id: `eq.${agentId}`,
      select: "version,created_at",
      order: "version.desc",
      limit: "50",
    });
    return rows.map((r) => ({ version: r.version, createdAt: r.created_at }));
  }

  async getSoulVersion(agentId: string, version: number): Promise<SoulVersion | null> {
    const rows = await this.get<RawSoulVersion[]>("agent_soul_versions", {
      agent_id: `eq.${agentId}`,
      version: `eq.${version}`,
      limit: "1",
    });
    return rows.length > 0 ? mapSoulVersion(rows[0]) : null;
  }

  async close(): Promise<void> {
    // No persistent connection to close.
  }

  // -- HTTP helpers ---------------------------------------------------------

  private async get<T>(table: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.baseUrl}/${table}?${qs}`, {
      headers: { ...this.headers, Prefer: "count=exact" },
    });
    if (!res.ok) {
      throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async post(table: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${table}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Supabase POST ${table}: ${res.status} ${await res.text()}`);
    }
  }

  private async patch(
    table: string,
    filter: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<void> {
    const qs = new URLSearchParams(filter).toString();
    const res = await fetch(`${this.baseUrl}/${table}?${qs}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Supabase PATCH ${table}: ${res.status} ${await res.text()}`);
    }
  }

  private async del(table: string, filter: Record<string, string>): Promise<void> {
    const qs = new URLSearchParams(filter).toString();
    const res = await fetch(`${this.baseUrl}/${table}?${qs}`, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`Supabase DELETE ${table}: ${res.status} ${await res.text()}`);
    }
  }

  private async rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/rpc/${fn}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Supabase RPC ${fn}: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
}

// ---------------------------------------------------------------------------
// Raw row types (snake_case from PostgREST)
// ---------------------------------------------------------------------------

type RawConversation = {
  id: string;
  agent_id: string;
  user_id: string;
  user_email: string | null;
  gateway: string;
  started_at: string;
  last_message_at: string;
  message_count: number;
  token_usage: { input: number; output: number } | string;
  metadata: Record<string, unknown> | string;
  created_at: string;
};

type RawMessage = {
  id: string;
  conversation_id: string;
  agent_id: string;
  user_id: string;
  role: string;
  content: string;
  tool_calls: unknown[] | null;
  token_count: number | null;
  created_at: string;
};

type RawMemoryEntry = {
  id: string;
  agent_id: string;
  user_id: string;
  category: string;
  topic: string;
  content: string;
  confidence: number;
  source: string | null;
  last_accessed: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type RawUsageMetric = {
  id: string;
  agent_id: string;
  date: string;
  conversations: number;
  messages: number;
  tool_calls: number;
  tokens_input: number;
  tokens_output: number;
  errors: number;
  avg_latency_ms: number | null;
  unique_users: number;
  created_at: string;
};

type RawCronJob = {
  id: string;
  agent_id: string;
  name: string;
  schedule: string;
  action: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

type RawCronRun = {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  result: unknown;
  error: string | null;
};

type RawAuditEvent = {
  id: string;
  event_type: string;
  agent_id: string | null;
  user_id: string | null;
  action: string;
  details: Record<string, unknown> | string | null;
  ip_address: string | null;
  created_at: string;
};

type RawErrorEvent = {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  user_id: string | null;
  error_type: string;
  error_message: string | null;
  tool_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type RawHealthSample = {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  user_id: string | null;
  turn_duration_ms: number;
  response_latency_ms: number | null;
  status: string;
  error_code: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  model: string | null;
  created_at: string;
};

type RawSoulVersion = {
  id: string;
  agent_id: string;
  version: number;
  content: string;
  created_by: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapSoulVersion(r: RawSoulVersion): SoulVersion {
  return {
    id: r.id,
    agentId: r.agent_id,
    version: r.version,
    content: r.content,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function mapConversation(r: RawConversation): Conversation {
  const tu =
    typeof r.token_usage === "string"
      ? JSON.parse(r.token_usage)
      : (r.token_usage ?? { input: 0, output: 0 });
  const md = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {});
  return {
    id: r.id,
    agentId: r.agent_id,
    userId: r.user_id,
    userEmail: r.user_email,
    gateway: r.gateway,
    startedAt: r.started_at,
    lastMessageAt: r.last_message_at,
    messageCount: r.message_count ?? 0,
    tokenUsage: tu,
    metadata: md,
    createdAt: r.created_at,
  };
}

function mapMessage(r: RawMessage): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    agentId: r.agent_id,
    userId: r.user_id,
    role: r.role as Message["role"],
    content: r.content,
    toolCalls: r.tool_calls as Message["toolCalls"],
    tokenCount: r.token_count,
    createdAt: r.created_at,
  };
}

function mapMemoryEntry(r: RawMemoryEntry): MemoryEntry {
  return {
    id: r.id,
    agentId: r.agent_id,
    userId: r.user_id,
    category: r.category as MemoryEntry["category"],
    topic: r.topic,
    content: r.content,
    confidence: r.confidence ?? 1.0,
    source: r.source,
    lastAccessed: r.last_accessed,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapUsageMetric(r: RawUsageMetric): UsageMetric {
  return {
    id: r.id,
    agentId: r.agent_id,
    date: r.date,
    conversations: r.conversations ?? 0,
    messages: r.messages ?? 0,
    toolCalls: r.tool_calls ?? 0,
    tokensInput: r.tokens_input ?? 0,
    tokensOutput: r.tokens_output ?? 0,
    errors: r.errors ?? 0,
    avgLatencyMs: r.avg_latency_ms,
    uniqueUsers: r.unique_users ?? 0,
    createdAt: r.created_at,
  };
}

function mapCronJob(r: RawCronJob): CronJob {
  return {
    id: r.id,
    agentId: r.agent_id,
    name: r.name,
    schedule: r.schedule,
    action: r.action,
    enabled: r.enabled,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
  };
}

function mapCronRun(r: RawCronRun): CronRun {
  return {
    id: r.id,
    jobId: r.job_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status as CronRun["status"],
    result: r.result,
    error: r.error,
  };
}

function mapAuditEvent(r: RawAuditEvent): AuditEvent {
  const details = typeof r.details === "string" ? JSON.parse(r.details) : r.details;
  return {
    id: r.id,
    eventType: r.event_type,
    agentId: r.agent_id,
    userId: r.user_id,
    action: r.action,
    details,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
  };
}

function mapErrorEvent(r: RawErrorEvent): ErrorEvent {
  return {
    id: r.id,
    agentId: r.agent_id,
    conversationId: r.conversation_id,
    userId: r.user_id,
    errorType: r.error_type as ErrorEvent["errorType"],
    errorMessage: r.error_message,
    toolName: r.tool_name,
    details: r.details,
    createdAt: r.created_at,
  };
}

function mapHealthSample(r: RawHealthSample): AgentHealthSample {
  return {
    id: r.id,
    agentId: r.agent_id,
    conversationId: r.conversation_id,
    userId: r.user_id,
    turnDurationMs: r.turn_duration_ms,
    responseLatencyMs: r.response_latency_ms,
    status: r.status as AgentHealthSample["status"],
    errorCode: r.error_code,
    tokensInput: r.tokens_input,
    tokensOutput: r.tokens_output,
    model: r.model,
    createdAt: r.created_at,
  };
}
