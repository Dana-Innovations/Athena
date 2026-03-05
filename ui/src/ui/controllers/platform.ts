/**
 * Platform Controller
 *
 * Fetches Athena platform data (stats, conversations, memory, metrics, audit)
 * via gateway WebSocket methods registered in athena.platform.*.
 */

export type PlatformStats = {
  agents: number;
  conversations: number;
  messages: number;
  memoryEntries: number;
  activeUsersToday: number;
  errorsToday: number;
};

export type AgentStatsEntry = {
  agentId: string;
  conversations: number;
  messages: number;
  uniqueUsers: number;
  tokensInput: number;
  tokensOutput: number;
  errors: number;
  lastActivityAt: string | null;
};

export type PlatformConversation = {
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
};

export type PlatformMessage = {
  id: string;
  conversationId: string;
  agentId: string;
  userId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls: unknown[] | null;
  tokenCount: number | null;
  createdAt: string;
};

export type PlatformMemoryEntry = {
  id: string;
  agentId: string;
  userId: string;
  category: string;
  topic: string;
  content: string;
  confidence: number;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatformAuditEvent = {
  id: string;
  eventType: string;
  agentId: string | null;
  userId: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export type PlatformMetric = {
  id: string;
  agentId: string;
  date: string;
  conversations: number;
  messages: number;
  toolCalls: number;
  tokensInput: number;
  tokensOutput: number;
  errors: number;
  uniqueUsers: number;
};

export type PlatformState = {
  platformStatsLoading: boolean;
  platformStatsError: string | null;
  platformStats: PlatformStats | null;
  platformAgentStats: AgentStatsEntry[] | null;

  platformConversationsLoading: boolean;
  platformConversationsError: string | null;
  platformConversations: PlatformConversation[] | null;
  platformConversationsFilter: {
    agentId?: string;
    userId?: string;
    gateway?: string;
    search?: string;
  };
  platformSelectedConversation: string | null;
  platformMessages: PlatformMessage[] | null;
  platformMessagesLoading: boolean;

  platformMemoryLoading: boolean;
  platformMemoryError: string | null;
  platformMemory: PlatformMemoryEntry[] | null;
  platformMemoryFilter: {
    agentId?: string;
    userId?: string;
    category?: string;
    search?: string;
  };

  platformAuditLoading: boolean;
  platformAuditError: string | null;
  platformAudit: PlatformAuditEvent[] | null;
  platformAuditFilter: {
    agentId?: string;
    eventType?: string;
  };

  platformMetrics: PlatformMetric[] | null;
  platformMetricsLoading: boolean;

  client: {
    request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  } | null;
};

// -- Stats ------------------------------------------------------------------

export async function loadPlatformStats(state: PlatformState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.platformStatsLoading = true;
  state.platformStatsError = null;
  try {
    const [stats, agentRes] = await Promise.all([
      state.client.request<PlatformStats>("athena.platform.stats"),
      state.client.request<{ agents: AgentStatsEntry[] }>("athena.platform.agent_stats"),
    ]);
    state.platformStats = stats;
    state.platformAgentStats = agentRes.agents;
  } catch (err) {
    state.platformStatsError = `Failed to load stats: ${String(err)}`;
  } finally {
    state.platformStatsLoading = false;
  }
}

// -- Conversations ----------------------------------------------------------

export async function loadPlatformConversations(state: PlatformState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.platformConversationsLoading = true;
  state.platformConversationsError = null;
  try {
    const res = await state.client.request<{ conversations: PlatformConversation[] }>(
      "athena.platform.conversations",
      {
        agentId: state.platformConversationsFilter.agentId,
        userId: state.platformConversationsFilter.userId,
        gateway: state.platformConversationsFilter.gateway,
        limit: 50,
      },
    );
    state.platformConversations = res.conversations;
  } catch (err) {
    state.platformConversationsError = `Failed to load conversations: ${String(err)}`;
  } finally {
    state.platformConversationsLoading = false;
  }
}

export async function loadConversationMessages(
  state: PlatformState,
  conversationId: string,
): Promise<void> {
  if (!state.client) {
    return;
  }
  state.platformSelectedConversation = conversationId;
  state.platformMessagesLoading = true;
  try {
    const res = await state.client.request<{ messages: PlatformMessage[] }>(
      "athena.platform.messages",
      { conversationId, limit: 200 },
    );
    state.platformMessages = res.messages;
  } catch {
    state.platformMessages = null;
  } finally {
    state.platformMessagesLoading = false;
  }
}

export async function searchPlatformMessages(state: PlatformState, query: string): Promise<void> {
  if (!state.client || !query.trim()) {
    return;
  }
  state.platformConversationsLoading = true;
  try {
    const res = await state.client.request<{ messages: PlatformMessage[] }>(
      "athena.platform.messages.search",
      {
        query: query.trim(),
        agentId: state.platformConversationsFilter.agentId,
        limit: 50,
      },
    );
    state.platformMessages = res.messages;
    state.platformSelectedConversation = null;
  } catch {
    state.platformMessages = null;
  } finally {
    state.platformConversationsLoading = false;
  }
}

// -- Memory -----------------------------------------------------------------

export async function loadPlatformMemory(state: PlatformState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.platformMemoryLoading = true;
  state.platformMemoryError = null;
  try {
    const res = await state.client.request<{ entries: PlatformMemoryEntry[] }>(
      "athena.platform.memory",
      {
        agentId: state.platformMemoryFilter.agentId,
        userId: state.platformMemoryFilter.userId,
        category: state.platformMemoryFilter.category,
        search: state.platformMemoryFilter.search,
        limit: 100,
      },
    );
    state.platformMemory = res.entries;
  } catch (err) {
    state.platformMemoryError = `Failed to load memory: ${String(err)}`;
  } finally {
    state.platformMemoryLoading = false;
  }
}

export async function deletePlatformMemory(state: PlatformState, id: string): Promise<void> {
  if (!state.client) {
    return;
  }
  try {
    await state.client.request("athena.platform.memory.delete", { id });
    if (state.platformMemory) {
      state.platformMemory = state.platformMemory.filter((m) => m.id !== id);
    }
  } catch {
    // Silently ignore — UI will still show entry until next refresh
  }
}

// -- Metrics ----------------------------------------------------------------

export async function loadPlatformMetrics(state: PlatformState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.platformMetricsLoading = true;
  try {
    const res = await state.client.request<{ metrics: PlatformMetric[] }>(
      "athena.platform.metrics",
      { limit: 30 },
    );
    state.platformMetrics = res.metrics;
  } catch {
    state.platformMetrics = null;
  } finally {
    state.platformMetricsLoading = false;
  }
}

// -- Audit ------------------------------------------------------------------

export async function loadPlatformAudit(state: PlatformState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.platformAuditLoading = true;
  state.platformAuditError = null;
  try {
    const res = await state.client.request<{ events: PlatformAuditEvent[] }>(
      "athena.platform.audit",
      {
        agentId: state.platformAuditFilter.agentId,
        eventType: state.platformAuditFilter.eventType,
        limit: 100,
      },
    );
    state.platformAudit = res.events;
  } catch (err) {
    state.platformAuditError = `Failed to load audit events: ${String(err)}`;
  } finally {
    state.platformAuditLoading = false;
  }
}
