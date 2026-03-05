import { randomUUID } from "node:crypto";
/**
 * SQLite provider for the Athena platform database.
 * Uses Node.js built-in node:sqlite (Node 22+).
 * Implements the full AthenaDatabase interface for local development.
 */
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentStats,
  AthenaDatabase,
  AuditEvent,
  AuditFilter,
  Conversation,
  ConversationFilter,
  CronJob,
  CronRun,
  MemoryEntry,
  MemoryFilter,
  Message,
  MessageFilter,
  MetricsFilter,
  PlatformStats,
  UsageMetric,
} from "./types.js";

export class AthenaSqliteProvider implements AthenaDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
  }

  initSchema(): void {
    const schemaPath = join(dirname(new URL(import.meta.url).pathname), "schema.sql");
    const sql = readFileSync(schemaPath, "utf-8");
    this.db.exec(sql);
  }

  // -- Conversations --------------------------------------------------------

  createConversation(params: {
    agentId: string;
    userId: string;
    userEmail?: string;
    gateway: string;
    metadata?: Record<string, unknown>;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_conversations (id, agent_id, user_id, user_email, gateway, started_at, last_message_at, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.agentId,
        params.userId,
        params.userEmail ?? null,
        params.gateway,
        now,
        now,
        params.metadata ? JSON.stringify(params.metadata) : "{}",
        now,
      );
    return id;
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare(`SELECT * FROM agent_conversations WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapConversation(row) : null;
  }

  listConversations(filter?: ConversationFilter): Conversation[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];

    if (filter?.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter?.userId) {
      clauses.push("user_id = ?");
      params.push(filter.userId);
    }
    if (filter?.gateway) {
      clauses.push("gateway = ?");
      params.push(filter.gateway);
    }
    if (filter?.since) {
      clauses.push("last_message_at >= ?");
      params.push(filter.since);
    }
    if (filter?.until) {
      clauses.push("last_message_at <= ?");
      params.push(filter.until);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_conversations ${where} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return (rows as Array<Record<string, unknown>>).map(mapConversation);
  }

  updateConversationTokens(id: string, tokens: { input: number; output: number }): void {
    const existing = this.db
      .prepare(`SELECT token_usage FROM agent_conversations WHERE id = ?`)
      .get(id) as { token_usage: string } | undefined;
    if (!existing) {
      return;
    }

    const current = JSON.parse(existing.token_usage || "{}");
    const updated = {
      input: (current.input ?? 0) + tokens.input,
      output: (current.output ?? 0) + tokens.output,
    };
    this.db
      .prepare(`UPDATE agent_conversations SET token_usage = ? WHERE id = ?`)
      .run(JSON.stringify(updated), id);
  }

  // -- Messages -------------------------------------------------------------

  addMessage(params: {
    conversationId: string;
    agentId: string;
    userId: string;
    role: string;
    content: string;
    toolCalls?: unknown[];
    tokenCount?: number;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_messages (id, conversation_id, agent_id, user_id, role, content, tool_calls, token_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.conversationId,
        params.agentId,
        params.userId,
        params.role,
        params.content,
        params.toolCalls ? JSON.stringify(params.toolCalls) : null,
        params.tokenCount ?? null,
        now,
      );

    this.db
      .prepare(
        `UPDATE agent_conversations SET message_count = message_count + 1, last_message_at = ? WHERE id = ?`,
      )
      .run(now, params.conversationId);

    return id;
  }

  getMessages(filter: MessageFilter): Message[] {
    const clauses = ["conversation_id = ?"];
    const params: Array<string | number | null> = [filter.conversationId];

    if (filter.role) {
      clauses.push("role = ?");
      params.push(filter.role);
    }

    const limit = filter.limit ?? 200;
    const offset = filter.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_messages WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return (rows as Array<Record<string, unknown>>).map(mapMessage);
  }

  searchMessages(
    query: string,
    opts?: { limit?: number; offset?: number; agentId?: string },
  ): Message[] {
    const clauses = ["content LIKE ?"];
    const params: Array<string | number | null> = [`%${query}%`];

    if (opts?.agentId) {
      clauses.push("agent_id = ?");
      params.push(opts.agentId);
    }

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_messages WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return (rows as Array<Record<string, unknown>>).map(mapMessage);
  }

  // -- Memory ---------------------------------------------------------------

  upsertMemory(params: {
    agentId: string;
    userId: string;
    category: string;
    topic: string;
    content: string;
    confidence?: number;
    source?: string;
    expiresAt?: string;
  }): string {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT id FROM agent_memory WHERE agent_id = ? AND user_id = ? AND topic = ?`)
      .get(params.agentId, params.userId, params.topic) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE agent_memory SET content = ?, category = ?, confidence = ?, source = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          params.content,
          params.category,
          params.confidence ?? 1.0,
          params.source ?? null,
          params.expiresAt ?? null,
          now,
          existing.id,
        );
      return existing.id;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_memory (id, agent_id, user_id, category, topic, content, confidence, source, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.agentId,
        params.userId,
        params.category,
        params.topic,
        params.content,
        params.confidence ?? 1.0,
        params.source ?? null,
        params.expiresAt ?? null,
        now,
        now,
      );
    return id;
  }

  getMemory(filter: MemoryFilter): MemoryEntry[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];

    if (filter.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter.userId) {
      clauses.push("user_id = ?");
      params.push(filter.userId);
    }
    if (filter.category) {
      clauses.push("category = ?");
      params.push(filter.category);
    }
    if (filter.search) {
      clauses.push("(content LIKE ? OR topic LIKE ?)");
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM agent_memory ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return (rows as Array<Record<string, unknown>>).map(mapMemoryEntry);
  }

  deleteMemory(id: string): void {
    this.db.prepare(`DELETE FROM agent_memory WHERE id = ?`).run(id);
  }

  // -- Usage Metrics --------------------------------------------------------

  recordUsage(params: {
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
  }): void {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT id FROM usage_metrics WHERE agent_id = ? AND date = ?`)
      .get(params.agentId, params.date) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE usage_metrics SET
            conversations = conversations + ?,
            messages = messages + ?,
            tool_calls = tool_calls + ?,
            tokens_input = tokens_input + ?,
            tokens_output = tokens_output + ?,
            errors = errors + ?,
            unique_users = CASE WHEN ? > 0 THEN ? ELSE unique_users END,
            avg_latency_ms = CASE WHEN ? IS NOT NULL THEN ? ELSE avg_latency_ms END
          WHERE id = ?`,
        )
        .run(
          params.conversations ?? 0,
          params.messages ?? 0,
          params.toolCalls ?? 0,
          params.tokensInput ?? 0,
          params.tokensOutput ?? 0,
          params.errors ?? 0,
          params.uniqueUsers ?? 0,
          params.uniqueUsers ?? 0,
          params.avgLatencyMs ?? null,
          params.avgLatencyMs ?? null,
          existing.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO usage_metrics (id, agent_id, date, conversations, messages, tool_calls, tokens_input, tokens_output, errors, unique_users, avg_latency_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          params.agentId,
          params.date,
          params.conversations ?? 0,
          params.messages ?? 0,
          params.toolCalls ?? 0,
          params.tokensInput ?? 0,
          params.tokensOutput ?? 0,
          params.errors ?? 0,
          params.uniqueUsers ?? 0,
          params.avgLatencyMs ?? null,
          now,
        );
    }
  }

  getMetrics(filter?: MetricsFilter): UsageMetric[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];

    if (filter?.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter?.since) {
      clauses.push("date >= ?");
      params.push(filter.since);
    }
    if (filter?.until) {
      clauses.push("date <= ?");
      params.push(filter.until);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM usage_metrics ${where} ORDER BY date DESC`)
      .all(...params);
    return (rows as Array<Record<string, unknown>>).map(mapUsageMetric);
  }

  getAgentStats(agentId?: string): AgentStats[] {
    const where = agentId ? "WHERE agent_id = ?" : "";
    const params: Array<string | number | null> = agentId ? [agentId] : [];

    const rows = this.db
      .prepare(
        `SELECT
          agent_id,
          SUM(conversations) as conversations,
          SUM(messages) as messages,
          SUM(tokens_input) as tokens_input,
          SUM(tokens_output) as tokens_output,
          SUM(errors) as errors,
          MAX(unique_users) as unique_users,
          MAX(date) as last_date
        FROM usage_metrics ${where}
        GROUP BY agent_id
        ORDER BY agent_id`,
      )
      .all(...params);

    return (rows as Array<Record<string, unknown>>).map((r) => ({
      agentId: r.agent_id as string,
      conversations: (r.conversations as number) ?? 0,
      messages: (r.messages as number) ?? 0,
      uniqueUsers: (r.unique_users as number) ?? 0,
      tokensInput: (r.tokens_input as number) ?? 0,
      tokensOutput: (r.tokens_output as number) ?? 0,
      errors: (r.errors as number) ?? 0,
      lastActivityAt: (r.last_date as string) ?? null,
    }));
  }

  // -- Cron -----------------------------------------------------------------

  upsertCronJob(params: {
    agentId: string;
    name: string;
    schedule: string;
    action: string;
    enabled?: boolean;
  }): string {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT id FROM cron_jobs WHERE agent_id = ? AND name = ?`)
      .get(params.agentId, params.name) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(`UPDATE cron_jobs SET schedule = ?, action = ?, enabled = ? WHERE id = ?`)
        .run(params.schedule, params.action, params.enabled !== false ? 1 : 0, existing.id);
      return existing.id;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO cron_jobs (id, agent_id, name, schedule, action, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.agentId, params.name, params.schedule, params.action, 1, now);
    return id;
  }

  listCronJobs(agentId?: string): CronJob[] {
    const rows = agentId
      ? this.db.prepare(`SELECT * FROM cron_jobs WHERE agent_id = ? ORDER BY name`).all(agentId)
      : this.db.prepare(`SELECT * FROM cron_jobs ORDER BY agent_id, name`).all();
    return (rows as Array<Record<string, unknown>>).map(mapCronJob);
  }

  recordCronRun(params: {
    jobId: string;
    status: string;
    result?: unknown;
    error?: string;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO cron_runs (id, job_id, started_at, status, result, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.jobId,
        now,
        params.status,
        params.result != null ? JSON.stringify(params.result) : null,
        params.error ?? null,
      );

    if (params.status !== "running") {
      this.db.prepare(`UPDATE cron_jobs SET last_run_at = ? WHERE id = ?`).run(now, params.jobId);
    }

    return id;
  }

  getCronRuns(jobId: string, limit = 20): CronRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(jobId, limit);
    return (rows as Array<Record<string, unknown>>).map(mapCronRun);
  }

  // -- Audit ----------------------------------------------------------------

  logAudit(params: {
    eventType: string;
    agentId?: string;
    userId?: string;
    action: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO audit_events (id, event_type, agent_id, user_id, action, details, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.eventType,
        params.agentId ?? null,
        params.userId ?? null,
        params.action,
        params.details ? JSON.stringify(params.details) : null,
        params.ipAddress ?? null,
        now,
      );
    return id;
  }

  getAuditEvents(filter?: AuditFilter): AuditEvent[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];

    if (filter?.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter?.userId) {
      clauses.push("user_id = ?");
      params.push(filter.userId);
    }
    if (filter?.eventType) {
      clauses.push("event_type = ?");
      params.push(filter.eventType);
    }
    if (filter?.since) {
      clauses.push("created_at >= ?");
      params.push(filter.since);
    }
    if (filter?.until) {
      clauses.push("created_at <= ?");
      params.push(filter.until);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return (rows as Array<Record<string, unknown>>).map(mapAuditEvent);
  }

  // -- Aggregates -----------------------------------------------------------

  getPlatformStats(): PlatformStats {
    const today = new Date().toISOString().slice(0, 10);

    const convCount = (
      this.db.prepare(`SELECT COUNT(*) as c FROM agent_conversations`).get() as { c: number }
    ).c;
    const msgCount = (
      this.db.prepare(`SELECT COUNT(*) as c FROM agent_messages`).get() as { c: number }
    ).c;
    const memCount = (
      this.db.prepare(`SELECT COUNT(*) as c FROM agent_memory`).get() as { c: number }
    ).c;
    const agentCount = (
      this.db.prepare(`SELECT COUNT(DISTINCT agent_id) as c FROM agent_conversations`).get() as {
        c: number;
      }
    ).c;

    const activeToday = (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) as c FROM agent_conversations WHERE last_message_at >= ?`,
        )
        .get(`${today}T00:00:00`) as { c: number }
    ).c;

    const errorsToday = (
      this.db
        .prepare(`SELECT COALESCE(SUM(errors), 0) as c FROM usage_metrics WHERE date = ?`)
        .get(today) as { c: number }
    ).c;

    return {
      agents: agentCount,
      conversations: convCount,
      messages: msgCount,
      memoryEntries: memCount,
      activeUsersToday: activeToday,
      errorsToday: errorsToday,
    };
  }

  getTableStats(): Record<string, number> {
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
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
        count: number;
      };
      stats[table] = row.count;
    }
    return stats;
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapConversation(r: Record<string, unknown>): Conversation {
  return {
    id: r.id as string,
    agentId: r.agent_id as string,
    userId: r.user_id as string,
    userEmail: (r.user_email as string) ?? null,
    gateway: r.gateway as string,
    startedAt: r.started_at as string,
    lastMessageAt: r.last_message_at as string,
    messageCount: (r.message_count as number) ?? 0,
    tokenUsage: r.token_usage ? JSON.parse(r.token_usage as string) : { input: 0, output: 0 },
    metadata: r.metadata ? JSON.parse(r.metadata as string) : {},
    createdAt: r.created_at as string,
  };
}

function mapMessage(r: Record<string, unknown>): Message {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    agentId: r.agent_id as string,
    userId: r.user_id as string,
    role: r.role as "user" | "assistant" | "tool",
    content: r.content as string,
    toolCalls: r.tool_calls ? JSON.parse(r.tool_calls as string) : null,
    tokenCount: (r.token_count as number) ?? null,
    createdAt: r.created_at as string,
  };
}

function mapMemoryEntry(r: Record<string, unknown>): MemoryEntry {
  return {
    id: r.id as string,
    agentId: r.agent_id as string,
    userId: r.user_id as string,
    category: r.category as MemoryEntry["category"],
    topic: r.topic as string,
    content: r.content as string,
    confidence: (r.confidence as number) ?? 1.0,
    source: (r.source as string) ?? null,
    lastAccessed: (r.last_accessed as string) ?? null,
    expiresAt: (r.expires_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function mapUsageMetric(r: Record<string, unknown>): UsageMetric {
  return {
    id: r.id as string,
    agentId: r.agent_id as string,
    date: r.date as string,
    conversations: (r.conversations as number) ?? 0,
    messages: (r.messages as number) ?? 0,
    toolCalls: (r.tool_calls as number) ?? 0,
    tokensInput: (r.tokens_input as number) ?? 0,
    tokensOutput: (r.tokens_output as number) ?? 0,
    errors: (r.errors as number) ?? 0,
    avgLatencyMs: (r.avg_latency_ms as number) ?? null,
    uniqueUsers: (r.unique_users as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

function mapCronJob(r: Record<string, unknown>): CronJob {
  return {
    id: r.id as string,
    agentId: r.agent_id as string,
    name: r.name as string,
    schedule: r.schedule as string,
    action: r.action as string,
    enabled: r.enabled === 1,
    lastRunAt: (r.last_run_at as string) ?? null,
    nextRunAt: (r.next_run_at as string) ?? null,
    createdAt: r.created_at as string,
  };
}

function mapCronRun(r: Record<string, unknown>): CronRun {
  return {
    id: r.id as string,
    jobId: r.job_id as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null,
    status: r.status as CronRun["status"],
    result: r.result ? JSON.parse(r.result as string) : null,
    error: (r.error as string) ?? null,
  };
}

function mapAuditEvent(r: Record<string, unknown>): AuditEvent {
  return {
    id: r.id as string,
    eventType: r.event_type as string,
    agentId: (r.agent_id as string) ?? null,
    userId: (r.user_id as string) ?? null,
    action: r.action as string,
    details: r.details ? JSON.parse(r.details as string) : null,
    ipAddress: (r.ip_address as string) ?? null,
    createdAt: r.created_at as string,
  };
}
