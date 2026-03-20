/**
 * Athena Platform — best-effort persistence layer.
 *
 * Wraps AthenaDatabase calls so the chat pipeline can persist
 * conversations, messages, usage metrics, and audit events without
 * blocking or crashing the reply flow.  All writes are fire-and-forget.
 */
import { createAthenaDatabase, type AthenaDatabase } from "./database/index.js";

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let _db: AthenaDatabase | null = null;
let _initPromise: Promise<void> | null = null;

function db(): AthenaDatabase {
  if (!_db) {
    _db = createAthenaDatabase();
    _initPromise = Promise.resolve(_db.initSchema()).catch((err) => {
      console.warn("[platform-persist] initSchema failed:", err);
    });
  }
  return _db;
}

async function ready(): Promise<AthenaDatabase> {
  const d = db();
  if (_initPromise) {
    await _initPromise;
    _initPromise = null;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Session → conversation mapping cache
// ---------------------------------------------------------------------------

const sessionConversationMap = new Map<string, string>();

/**
 * Get or create a conversation row for the given session.
 * Returns the DB conversation ID.  Cached in-memory so repeated
 * messages in the same session don't hit the DB.
 */
export async function getOrCreateConversation(params: {
  sessionKey: string;
  agentId: string;
  userId: string;
  userEmail?: string;
  gateway: string;
}): Promise<string> {
  const cached = sessionConversationMap.get(params.sessionKey);
  if (cached) {
    return cached;
  }

  const d = await ready();
  const convId = await d.createConversation({
    agentId: params.agentId,
    userId: params.userId,
    userEmail: params.userEmail,
    gateway: params.gateway,
    metadata: { sessionKey: params.sessionKey },
  });

  sessionConversationMap.set(params.sessionKey, convId);
  return convId;
}

/**
 * Look up an already-cached conversation ID for a session key.
 * Returns undefined if the session hasn't been seen yet.
 */
export function getCachedConversationId(sessionKey: string): string | undefined {
  return sessionConversationMap.get(sessionKey);
}

/**
 * Remove a session from the cache (e.g. on /newchat).
 */
export function clearCachedConversation(sessionKey: string): void {
  sessionConversationMap.delete(sessionKey);
}

// ---------------------------------------------------------------------------
// Message persistence
// ---------------------------------------------------------------------------

export function persistUserMessage(params: {
  conversationId: string;
  agentId: string;
  userId: string;
  content: string;
}): void {
  void (async () => {
    const d = await ready();
    await d.addMessage({
      conversationId: params.conversationId,
      agentId: params.agentId,
      userId: params.userId,
      role: "user",
      content: params.content,
    });
  })().catch((err) => {
    console.warn("[platform-persist] persistUserMessage failed:", err);
  });
}

export function persistAssistantMessage(params: {
  conversationId: string;
  agentId: string;
  userId: string;
  content: string;
  tokenCount?: number;
  tokensInput?: number;
  tokensOutput?: number;
}): void {
  void (async () => {
    const d = await ready();
    await d.addMessage({
      conversationId: params.conversationId,
      agentId: params.agentId,
      userId: params.userId,
      role: "assistant",
      content: params.content,
      tokenCount: params.tokenCount,
    });
    if (params.tokensInput !== undefined || params.tokensOutput !== undefined) {
      await d.updateConversationTokens(params.conversationId, {
        input: params.tokensInput ?? 0,
        output: params.tokensOutput ?? 0,
      });
    }
  })().catch((err) => {
    console.warn("[platform-persist] persistAssistantMessage failed:", err);
  });
}

// ---------------------------------------------------------------------------
// Usage metrics
// ---------------------------------------------------------------------------

export function persistUsage(params: {
  agentId: string;
  conversations?: number;
  messages?: number;
  toolCalls?: number;
  tokensInput?: number;
  tokensOutput?: number;
  errors?: number;
  uniqueUsers?: number;
}): void {
  void (async () => {
    const d = await ready();
    const date = new Date().toISOString().slice(0, 10);
    await d.recordUsage({ ...params, date });
  })().catch((err) => {
    console.warn("[platform-persist] persistUsage failed:", err);
  });
}

// ---------------------------------------------------------------------------
// Error events
// ---------------------------------------------------------------------------

export function persistErrorEvent(params: {
  agentId: string;
  conversationId?: string;
  userId?: string;
  errorType: "tool_error" | "api_error" | "runtime_error";
  errorMessage?: string;
  toolName?: string;
  details?: Record<string, unknown>;
}): void {
  void (async () => {
    const d = await ready();
    await d.logErrorEvent(params);
    // Also bump the daily error counter so usage_metrics stays in sync
    const date = new Date().toISOString().slice(0, 10);
    await d.recordUsage({ agentId: params.agentId, date, errors: 1 });
  })().catch((err) => {
    console.warn("[platform-persist] persistErrorEvent failed:", err);
  });
}

// ---------------------------------------------------------------------------
// Health / Latency
// ---------------------------------------------------------------------------

export function persistHealthSample(params: {
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
}): void {
  void (async () => {
    const d = await ready();
    await d.logHealthSample(params);
  })().catch((err) => {
    console.warn("[platform-persist] persistHealthSample failed:", err);
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function persistAudit(params: {
  eventType: string;
  agentId?: string;
  userId?: string;
  action: string;
  details?: Record<string, unknown>;
}): void {
  void (async () => {
    const d = await ready();
    await d.logAudit(params);
  })().catch((err) => {
    console.warn("[platform-persist] persistAudit failed:", err);
  });
}
