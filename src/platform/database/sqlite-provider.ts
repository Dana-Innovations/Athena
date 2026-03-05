import { randomUUID } from "node:crypto";
/**
 * SQLite provider for the Athena platform database.
 * Uses Node.js built-in node:sqlite (Node 22+).
 * Mirrors the Supabase Postgres schema for local development.
 */
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class AthenaSqliteProvider {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
  }

  /** Run the schema SQL to create all tables and indexes. */
  initSchema(): void {
    const schemaPath = join(dirname(new URL(import.meta.url).pathname), "schema.sql");
    const sql = readFileSync(schemaPath, "utf-8");
    this.db.exec(sql);
  }

  /** Create a new conversation, returns its ID. */
  createConversation(params: {
    agentId: string;
    userId: string;
    userEmail?: string;
    gateway: string;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_conversations (id, agent_id, user_id, user_email, gateway, started_at, last_message_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.agentId,
        params.userId,
        params.userEmail ?? null,
        params.gateway,
        now,
        now,
        now,
      );
    return id;
  }

  /** Add a message to a conversation. */
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

  /** Store or update a memory entry. Upserts on (agent_id, user_id, topic). */
  upsertMemory(params: {
    agentId: string;
    userId: string;
    category: string;
    topic: string;
    content: string;
    confidence?: number;
    source?: string;
  }): string {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT id FROM agent_memory WHERE agent_id = ? AND user_id = ? AND topic = ?`)
      .get(params.agentId, params.userId, params.topic) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE agent_memory SET content = ?, category = ?, confidence = ?, source = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          params.content,
          params.category,
          params.confidence ?? 1.0,
          params.source ?? null,
          now,
          existing.id,
        );
      return existing.id;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_memory (id, agent_id, user_id, category, topic, content, confidence, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now,
        now,
      );
    return id;
  }

  /** Search memory entries by content (basic LIKE search; Postgres uses full-text). */
  searchMemory(
    query: string,
    agentId?: string,
  ): Array<{
    id: string;
    agentId: string;
    userId: string;
    topic: string;
    content: string;
    category: string;
  }> {
    const pattern = `%${query}%`;
    const sql = agentId
      ? `SELECT id, agent_id, user_id, topic, content, category FROM agent_memory WHERE agent_id = ? AND content LIKE ?`
      : `SELECT id, agent_id, user_id, topic, content, category FROM agent_memory WHERE content LIKE ?`;
    const rows = agentId
      ? this.db.prepare(sql).all(agentId, pattern)
      : this.db.prepare(sql).all(pattern);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      agentId: r.agent_id as string,
      userId: r.user_id as string,
      topic: r.topic as string,
      content: r.content as string,
      category: r.category as string,
    }));
  }

  /** Get conversations for an agent, ordered by most recent. */
  getConversations(
    agentId: string,
    limit = 50,
  ): Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    gateway: string;
    messageCount: number;
    lastMessageAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, user_email, gateway, message_count, last_message_at
         FROM agent_conversations WHERE agent_id = ? ORDER BY last_message_at DESC LIMIT ?`,
      )
      .all(agentId, limit);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      userEmail: r.user_email as string | null,
      gateway: r.gateway as string,
      messageCount: r.message_count as number,
      lastMessageAt: r.last_message_at as string,
    }));
  }

  /** Record a usage metric (upserts on agent_id + date). */
  recordUsage(params: {
    agentId: string;
    date: string;
    conversations?: number;
    messages?: number;
    toolCalls?: number;
    tokensInput?: number;
    tokensOutput?: number;
    errors?: number;
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
            errors = errors + ?
          WHERE id = ?`,
        )
        .run(
          params.conversations ?? 0,
          params.messages ?? 0,
          params.toolCalls ?? 0,
          params.tokensInput ?? 0,
          params.tokensOutput ?? 0,
          params.errors ?? 0,
          existing.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO usage_metrics (id, agent_id, date, conversations, messages, tool_calls, tokens_input, tokens_output, errors, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          now,
        );
    }
  }

  /** Log an audit event. */
  logAudit(params: {
    eventType: string;
    agentId?: string;
    userId?: string;
    action: string;
    details?: Record<string, unknown>;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO audit_events (id, event_type, agent_id, user_id, action, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.eventType,
        params.agentId ?? null,
        params.userId ?? null,
        params.action,
        params.details ? JSON.stringify(params.details) : null,
        now,
      );
    return id;
  }

  /** Get table row counts for health/status checks. */
  getStats(): Record<string, number> {
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
