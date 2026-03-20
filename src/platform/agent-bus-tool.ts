import { pluginUserStore } from "../plugins/user-context.js";
/**
 * Inter-agent communication tool.
 *
 * Registers an "ask_agent" tool that lets an agent query another agent
 * via the message bus. The target agent's handler runs the query through
 * the LLM and returns a text response.
 *
 * This is the runtime wiring that connects the AgentMessageBus (Phase 1
 * infrastructure) to actual agent tool use (Phase 2 activation).
 */
import {
  getAgentMessageBus,
  type AgentMessage,
  type AgentMessageType,
  type AgentReply,
} from "./message-bus.js";
import { loadAgentRegistry, findAgent } from "./registry.js";

const TOOL_NAME = "ask_agent";

type AgentQueryHandler = (
  msgType: AgentMessageType,
  question: string,
  userId?: string,
) => Promise<string>;

/**
 * Subscribe an agent to the message bus so it can receive queries
 * from other agents. The handler receives the question and should
 * return a text answer (typically by running it through the LLM).
 */
export function subscribeAgentToBus(agentId: string, handler: AgentQueryHandler): void {
  const bus = getAgentMessageBus();
  bus.subscribe(agentId, async (msg: AgentMessage): Promise<AgentReply> => {
    // query → payload.question, delegate → payload.task, notify → payload.event
    const question =
      (msg.payload.question as string) ??
      (msg.payload.task as string) ??
      (msg.payload.event as string) ??
      JSON.stringify(msg.payload);
    try {
      const answer = await handler(msg.type, question, msg.userId);
      return {
        id: `reply_${Date.now()}`,
        inReplyTo: msg.id,
        from: agentId,
        to: msg.from,
        payload: { answer },
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        id: `reply_${Date.now()}`,
        inReplyTo: msg.id,
        from: agentId,
        to: msg.from,
        payload: {},
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  });
}

/**
 * Create the ask_agent tool definition for use in the plugin system.
 *
 * The callerAgentId should be the ID of the agent that owns this tool
 * instance (e.g. "athena"). If not provided, it's resolved from the
 * current session key at call time.
 */
export function createAskAgentToolDef(
  registryRoot: string,
  callerAgentId?: string,
): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<string>;
} {
  return {
    name: TOOL_NAME,
    description:
      "Ask another agent a question and get their response. " +
      "Use this to collaborate with specialist agents (e.g. ask Scheduler " +
      "about calendar availability, ask Analyst about data insights). " +
      `Available agents: ${listRegisteredAgentNames(registryRoot).join(", ")}`,
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "The agent ID to query (e.g. 'scheduler', 'analyst', 'athena')",
        },
        question: {
          type: "string",
          description: "The question or task to send to the other agent",
        },
      },
      required: ["agent", "question"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>): Promise<string> {
      const targetAgent = (typeof params.agent === "string" ? params.agent : "").trim();
      const question = (typeof params.question === "string" ? params.question : "").trim();

      if (!targetAgent || !question) {
        return "Error: both 'agent' and 'question' parameters are required.";
      }

      const registry = loadAgentRegistry(registryRoot);
      const agent = findAgent(registry, targetAgent);
      if (!agent) {
        const available = registry.agents.map((e) => e.definition.metadata.name).join(", ");
        return `Error: agent "${targetAgent}" not found. Available agents: ${available}`;
      }

      const bus = getAgentMessageBus();
      const callerCtx = pluginUserStore.getStore();
      const fromAgent = callerAgentId ?? "unknown";

      if (fromAgent === targetAgent) {
        return "Error: an agent cannot query itself.";
      }

      if (!bus.isRegistered(targetAgent)) {
        return (
          `Agent "${targetAgent}" is not currently online on the message bus. ` +
          `Registered agents: ${bus.listAgents().join(", ") || "(none)"}`
        );
      }

      try {
        const reply = await bus.query(
          fromAgent,
          targetAgent,
          { question },
          { userId: callerCtx?.senderId, timeoutMs: 30_000 },
        );

        if (reply.error) {
          return `Agent "${targetAgent}" returned an error: ${reply.error}`;
        }

        const answer = reply.payload.answer;
        return typeof answer === "string" ? answer : JSON.stringify(reply.payload);
      } catch (err) {
        return `Failed to reach agent "${targetAgent}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function listRegisteredAgentNames(registryRoot: string): string[] {
  try {
    const registry = loadAgentRegistry(registryRoot);
    return registry.agents.map((e) => e.definition.metadata.name);
  } catch {
    return [];
  }
}

/**
 * Create the delegate_to_agent tool definition.
 *
 * Fire-and-forget: sends a task to a specialist agent and returns a
 * delegationId immediately. The specialist processes the task asynchronously
 * and is expected to deliver the result directly to the user via proactive
 * messaging — the caller does NOT wait for a reply.
 *
 * Use this for long-running tasks where you want to hand off responsibility
 * without blocking the conversation. Use ask_agent when you need a synchronous
 * answer to include in your own reply.
 */
export function createDelegateAgentToolDef(
  registryRoot: string,
  callerAgentId?: string,
): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<string>;
} {
  return {
    name: "delegate_to_agent",
    description:
      "Delegate a task to a specialist agent and continue without waiting for their response. " +
      "The specialist will deliver results directly to the user when complete. " +
      "Use this for background tasks (e.g. 'schedule this meeting', 'summarise my week'). " +
      `Available agents: ${listRegisteredAgentNames(registryRoot).join(", ")}`,
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "The agent ID to delegate to (e.g. 'scheduler')",
        },
        task: {
          type: "string",
          description: "The task description to delegate. Be specific about what you want done.",
        },
        context: {
          type: "string",
          description:
            "Optional: additional context the agent needs (user preferences, constraints, etc.)",
        },
      },
      required: ["agent", "task"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>): Promise<string> {
      const targetAgent = (typeof params.agent === "string" ? params.agent : "").trim();
      const task = (typeof params.task === "string" ? params.task : "").trim();
      const context = typeof params.context === "string" ? params.context.trim() : undefined;

      if (!targetAgent || !task) {
        return "Error: both 'agent' and 'task' parameters are required.";
      }

      const registry = loadAgentRegistry(registryRoot);
      const agent = findAgent(registry, targetAgent);
      if (!agent) {
        const available = registry.agents.map((e) => e.definition.metadata.name).join(", ");
        return `Error: agent "${targetAgent}" not found. Available agents: ${available}`;
      }

      const bus = getAgentMessageBus();
      const callerCtx = pluginUserStore.getStore();
      const fromAgent = callerAgentId ?? "unknown";

      console.log(
        `[bus] delegate_to_agent: from=${fromAgent} to=${targetAgent} bus=[${bus.listAgents().join(", ") || "(empty)"}]`,
      );

      if (fromAgent === targetAgent) {
        return "Error: an agent cannot delegate to itself.";
      }

      if (!bus.isRegistered(targetAgent)) {
        return (
          `Agent "${targetAgent}" is not currently online on the message bus. ` +
          `Registered agents: ${bus.listAgents().join(", ") || "(none)"}`
        );
      }

      try {
        const delegationId = bus.delegate(
          fromAgent,
          targetAgent,
          { task, context: context ?? null },
          { userId: callerCtx?.senderId },
        );
        return (
          `Task delegated to ${agent.definition.metadata.displayName} (id: ${delegationId}). ` +
          `They will handle it and respond directly to the user when complete.`
        );
      } catch (err) {
        return `Failed to delegate to agent "${targetAgent}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * Create the notify_agent tool definition.
 *
 * Sends a fire-and-forget informational event to another agent.
 * No reply is expected. Use this to inform agents of state changes
 * (e.g. "calendar event created", "user prefers mornings for meetings").
 */
export function createNotifyAgentToolDef(
  registryRoot: string,
  callerAgentId?: string,
): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<string>;
} {
  return {
    name: "notify_agent",
    description:
      "Send an informational event to another agent. No reply is expected. " +
      "Use this to share context or state updates (e.g. 'user prefers mornings', " +
      "'calendar conflict detected', 'project deadline changed'). " +
      `Available agents: ${listRegisteredAgentNames(registryRoot).join(", ")}`,
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "The agent ID to notify (e.g. 'scheduler')",
        },
        event: {
          type: "string",
          description: "A short event name or type (e.g. 'calendar_updated', 'user_preference')",
        },
        payload: {
          type: "object",
          description: "Key-value data to include with the event",
          additionalProperties: true,
        },
      },
      required: ["agent", "event"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>): Promise<string> {
      const targetAgent = (typeof params.agent === "string" ? params.agent : "").trim();
      const event = (typeof params.event === "string" ? params.event : "").trim();
      const payload =
        params.payload && typeof params.payload === "object"
          ? (params.payload as Record<string, unknown>)
          : {};

      if (!targetAgent || !event) {
        return "Error: both 'agent' and 'event' parameters are required.";
      }

      const registry = loadAgentRegistry(registryRoot);
      const agent = findAgent(registry, targetAgent);
      if (!agent) {
        const available = registry.agents.map((e) => e.definition.metadata.name).join(", ");
        return `Error: agent "${targetAgent}" not found. Available agents: ${available}`;
      }

      const bus = getAgentMessageBus();
      const callerCtx = pluginUserStore.getStore();
      const fromAgent = callerAgentId ?? "unknown";

      if (!bus.isRegistered(targetAgent)) {
        return (
          `Agent "${targetAgent}" is not currently online (notification dropped). ` +
          `Registered agents: ${bus.listAgents().join(", ") || "(none)"}`
        );
      }

      try {
        await bus.notify(
          fromAgent,
          targetAgent,
          { event, ...payload },
          { userId: callerCtx?.senderId },
        );
        return `Notification "${event}" sent to ${agent.definition.metadata.displayName}.`;
      } catch (err) {
        return `Failed to notify agent "${targetAgent}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * List agents available for inter-agent communication.
 * Returns formatted text suitable for an LLM tool response.
 */
export function listAvailableAgents(registryRoot: string): string {
  const registry = loadAgentRegistry(registryRoot);
  const bus = getAgentMessageBus();

  const lines = registry.agents.map((entry) => {
    const def = entry.definition;
    const online = bus.isRegistered(def.metadata.name) ? "online" : "offline";
    return `- **${def.metadata.displayName}** (${def.metadata.name}) [${online}]: ${def.metadata.description}`;
  });

  return lines.join("\n");
}
