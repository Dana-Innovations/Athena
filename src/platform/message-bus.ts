/**
 * Agent Message Bus
 *
 * Enables inter-agent communication with three patterns:
 *   - query:    request/response (synchronous-style, awaitable)
 *   - delegate: hand off a task to another agent (fire-and-wait)
 *   - notify:   fire-and-forget event
 *
 * Phase 1: query/reply pattern.
 * Phase 2: delegate and notify (activated when multi-agent is live).
 */

export type AgentMessageType = "query" | "delegate" | "notify";

export type AgentMessage = {
  id: string;
  type: AgentMessageType;
  from: string;
  to: string;
  /** User context (propagated for tool calls and audit) */
  userId?: string;
  payload: Record<string, unknown>;
  /** For query/delegate: the caller sets this to get a reply */
  replyWhenDone?: boolean;
  timestamp: number;
};

export type AgentReply = {
  id: string;
  inReplyTo: string;
  from: string;
  to: string;
  payload: Record<string, unknown>;
  error?: string;
  timestamp: number;
};

export type MessageHandler = (message: AgentMessage) => Promise<AgentReply | void>;

type BusSubscription = {
  agentId: string;
  handler: MessageHandler;
};

type PendingQuery = {
  resolve: (reply: AgentReply) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const _MAX_DELEGATION_DEPTH = 5;
const QUERY_TIMEOUT_MS = 30_000;

let messageCounter = 0;

export class AgentMessageBus {
  private subscriptions = new Map<string, BusSubscription>();
  private pendingQueries = new Map<string, PendingQuery>();
  private messageLog: Array<AgentMessage | AgentReply> = [];
  private acl = new Map<string, Set<string>>();

  /**
   * Register an agent's message handler on the bus.
   */
  subscribe(agentId: string, handler: MessageHandler): void {
    this.subscriptions.set(agentId, { agentId, handler });
  }

  unsubscribe(agentId: string): void {
    this.subscriptions.delete(agentId);
  }

  /**
   * Configure which agents this agent is allowed to contact.
   * Pass ["*"] for unrestricted.
   */
  setAcl(agentId: string, canContact: string[]): void {
    this.acl.set(agentId, new Set(canContact));
  }

  /**
   * Send a query to another agent and await the reply.
   */
  async query(
    from: string,
    to: string,
    payload: Record<string, unknown>,
    opts?: { userId?: string; timeoutMs?: number },
  ): Promise<AgentReply> {
    this.assertCanContact(from, to);
    const target = this.subscriptions.get(to);
    if (!target) {
      throw new Error(`Agent "${to}" is not registered on the message bus`);
    }

    const msg = this.buildMessage("query", from, to, payload, opts?.userId);
    this.messageLog.push(msg);

    return new Promise<AgentReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingQueries.delete(msg.id);
        reject(
          new Error(`Query to "${to}" timed out after ${opts?.timeoutMs ?? QUERY_TIMEOUT_MS}ms`),
        );
      }, opts?.timeoutMs ?? QUERY_TIMEOUT_MS);

      this.pendingQueries.set(msg.id, { resolve, reject, timer });

      target
        .handler(msg)
        .then((reply) => {
          const pending = this.pendingQueries.get(msg.id);
          if (!pending) {
            return;
          }
          clearTimeout(pending.timer);
          this.pendingQueries.delete(msg.id);

          const finalReply = reply ?? {
            id: this.nextId(),
            inReplyTo: msg.id,
            from: to,
            to: from,
            payload: {},
            timestamp: Date.now(),
          };
          this.messageLog.push(finalReply);
          pending.resolve(finalReply);
        })
        .catch((err) => {
          const pending = this.pendingQueries.get(msg.id);
          if (!pending) {
            return;
          }
          clearTimeout(pending.timer);
          this.pendingQueries.delete(msg.id);
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  /**
   * Send a fire-and-forget notification to another agent.
   */
  async notify(
    from: string,
    to: string,
    payload: Record<string, unknown>,
    opts?: { userId?: string },
  ): Promise<void> {
    this.assertCanContact(from, to);
    const target = this.subscriptions.get(to);
    if (!target) {
      console.warn(`[bus] notify to unregistered agent "${to}" (dropped)`);
      return;
    }

    const msg = this.buildMessage("notify", from, to, payload, opts?.userId);
    this.messageLog.push(msg);

    target.handler(msg).catch((err) => {
      console.warn(`[bus] notify handler error for "${to}":`, err);
    });
  }

  /**
   * Returns the full message log (for audit/debugging).
   */
  getLog(): ReadonlyArray<AgentMessage | AgentReply> {
    return this.messageLog;
  }

  /**
   * List all registered agent IDs.
   */
  listAgents(): string[] {
    return [...this.subscriptions.keys()];
  }

  isRegistered(agentId: string): boolean {
    return this.subscriptions.has(agentId);
  }

  private assertCanContact(from: string, to: string): void {
    const allowed = this.acl.get(from);
    if (!allowed) {
      return;
    }
    if (allowed.has("*")) {
      return;
    }
    if (!allowed.has(to)) {
      throw new Error(
        `Agent "${from}" is not allowed to contact "${to}". ` +
          `Allowed: [${[...allowed].join(", ")}]`,
      );
    }
  }

  private buildMessage(
    type: AgentMessageType,
    from: string,
    to: string,
    payload: Record<string, unknown>,
    userId?: string,
  ): AgentMessage {
    return {
      id: this.nextId(),
      type,
      from,
      to,
      userId,
      payload,
      replyWhenDone: type === "query",
      timestamp: Date.now(),
    };
  }

  private nextId(): string {
    return `msg_${++messageCounter}_${Date.now()}`;
  }
}

let globalBus: AgentMessageBus | null = null;

export function getAgentMessageBus(): AgentMessageBus {
  if (!globalBus) {
    globalBus = new AgentMessageBus();
  }
  return globalBus;
}

export function resetAgentMessageBus(): void {
  globalBus = null;
}
