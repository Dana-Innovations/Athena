/**
 * Athena Platform Database — provider interface.
 *
 * Both SQLite (local dev) and Supabase (production) implement this contract.
 * All timestamps are ISO 8601 strings. IDs are UUIDs (TEXT).
 */

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string;
  agentId: string;
  userId: string;
  userEmail: string | null;
  gateway: string;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  tokenUsage: { input: number; output: number };
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  agentId: string;
  userId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls: Array<{ name: string; args: unknown; result?: unknown }> | null;
  tokenCount: number | null;
  createdAt: string;
};

export type MemoryEntry = {
  id: string;
  agentId: string;
  userId: string;
  category: "preference" | "context" | "fact";
  topic: string;
  content: string;
  confidence: number;
  source: string | null;
  lastAccessed: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UsageMetric = {
  id: string;
  agentId: string;
  date: string;
  conversations: number;
  messages: number;
  toolCalls: number;
  tokensInput: number;
  tokensOutput: number;
  errors: number;
  avgLatencyMs: number | null;
  uniqueUsers: number;
  createdAt: string;
};

export type CronJob = {
  id: string;
  agentId: string;
  name: string;
  schedule: string;
  action: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
};

export type CronRun = {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  result: unknown;
  error: string | null;
};

export type AuditEvent = {
  id: string;
  eventType: string;
  agentId: string | null;
  userId: string | null;
  action: string;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

export type ListOptions = {
  limit?: number;
  offset?: number;
};

export type ConversationFilter = ListOptions & {
  agentId?: string;
  userId?: string;
  gateway?: string;
  since?: string;
  until?: string;
};

export type MessageFilter = ListOptions & {
  conversationId: string;
  role?: string;
};

export type MemoryFilter = ListOptions & {
  agentId?: string;
  userId?: string;
  category?: string;
  search?: string;
};

export type MetricsFilter = {
  agentId?: string;
  since?: string;
  until?: string;
};

export type AuditFilter = ListOptions & {
  agentId?: string;
  userId?: string;
  eventType?: string;
  since?: string;
  until?: string;
};

// ---------------------------------------------------------------------------
// Aggregate types
// ---------------------------------------------------------------------------

export type PlatformStats = {
  agents: number;
  conversations: number;
  messages: number;
  memoryEntries: number;
  activeUsersToday: number;
  errorsToday: number;
};

export type AgentStats = {
  agentId: string;
  conversations: number;
  messages: number;
  uniqueUsers: number;
  tokensInput: number;
  tokensOutput: number;
  errors: number;
  lastActivityAt: string | null;
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AthenaDatabase {
  /** Initialize schema (idempotent — safe to call on every startup). */
  initSchema(): void | Promise<void>;

  // -- Conversations --------------------------------------------------------

  createConversation(params: {
    agentId: string;
    userId: string;
    userEmail?: string;
    gateway: string;
    metadata?: Record<string, unknown>;
  }): string | Promise<string>;

  getConversation(id: string): Conversation | null | Promise<Conversation | null>;

  listConversations(filter?: ConversationFilter): Conversation[] | Promise<Conversation[]>;

  updateConversationTokens(
    id: string,
    tokens: { input: number; output: number },
  ): void | Promise<void>;

  // -- Messages -------------------------------------------------------------

  addMessage(params: {
    conversationId: string;
    agentId: string;
    userId: string;
    role: string;
    content: string;
    toolCalls?: unknown[];
    tokenCount?: number;
  }): string | Promise<string>;

  getMessages(filter: MessageFilter): Message[] | Promise<Message[]>;

  /** Full-text search across all messages. */
  searchMessages(
    query: string,
    opts?: ListOptions & { agentId?: string },
  ): Message[] | Promise<Message[]>;

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
  }): string | Promise<string>;

  getMemory(filter: MemoryFilter): MemoryEntry[] | Promise<MemoryEntry[]>;

  deleteMemory(id: string): void | Promise<void>;

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
  }): void | Promise<void>;

  getMetrics(filter?: MetricsFilter): UsageMetric[] | Promise<UsageMetric[]>;

  /** Aggregate stats per agent (for the dashboard). */
  getAgentStats(agentId?: string): AgentStats[] | Promise<AgentStats[]>;

  // -- Cron -----------------------------------------------------------------

  upsertCronJob(params: {
    agentId: string;
    name: string;
    schedule: string;
    action: string;
    enabled?: boolean;
  }): string | Promise<string>;

  listCronJobs(agentId?: string): CronJob[] | Promise<CronJob[]>;

  recordCronRun(params: {
    jobId: string;
    status: string;
    result?: unknown;
    error?: string;
  }): string | Promise<string>;

  getCronRuns(jobId: string, limit?: number): CronRun[] | Promise<CronRun[]>;

  // -- Audit ----------------------------------------------------------------

  logAudit(params: {
    eventType: string;
    agentId?: string;
    userId?: string;
    action: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): string | Promise<string>;

  getAuditEvents(filter?: AuditFilter): AuditEvent[] | Promise<AuditEvent[]>;

  // -- Aggregates -----------------------------------------------------------

  getPlatformStats(): PlatformStats | Promise<PlatformStats>;

  // -- Lifecycle ------------------------------------------------------------

  getTableStats(): Record<string, number> | Promise<Record<string, number>>;
  close(): void | Promise<void>;
}
