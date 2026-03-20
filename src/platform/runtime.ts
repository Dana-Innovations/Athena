/**
 * AgentRuntime — Portability Interface
 *
 * Abstracts the underlying LLM execution framework so that agent logic
 * is not coupled to OpenClaw. A different runtime (e.g. a mock for testing,
 * a LangGraph adapter, or a future Bedrock adapter) can be swapped in by
 * implementing this interface.
 *
 * Phase 6.3 implementation.
 *
 * ## How to swap the runtime
 * 1. Implement `AgentRuntime` for your framework.
 * 2. Pass your implementation to `setAgentRuntime()` before agents start.
 * 3. Any code that calls `getAgentRuntime()` will use your implementation.
 *
 * The OpenClaw adapter (`OpenClawRuntime`) is the production default and
 * is wired up in `extensions/sonance-cortex/index.ts`.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type AgentMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
};

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<string>;
};

export type AgentRunOptions = {
  /** System prompt / SOUL override for this turn */
  systemPrompt?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Tools available to the agent during this run */
  tools?: AgentToolDef[];
  /** User ID for audit and context propagation */
  userId?: string;
  /** Model override (e.g. "anthropic/claude-opus-4-6") */
  model?: string;
};

export type AgentRunResult = {
  /** Final text response from the agent */
  text: string;
  /** Tool calls made during the run (may be empty) */
  toolCalls: AgentToolCall[];
  /** Token usage if available */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Stop reason: "end_turn" | "tool_use" | "max_tokens" | "error" */
  stopReason: string;
};

// ---------------------------------------------------------------------------
// AgentRuntime interface
// ---------------------------------------------------------------------------

/**
 * The core portability interface. Implement this to connect any LLM
 * framework to the Athena platform.
 */
export interface AgentRuntime {
  /**
   * Unique identifier for this runtime implementation.
   * Used for logging and diagnostics (e.g. "openclaw", "mock", "bedrock").
   */
  readonly id: string;

  /**
   * Run a single agent turn against the given conversation history.
   *
   * @param agentId   - The agent's unique ID (used for session/context lookup)
   * @param messages  - Conversation history (user + assistant turns)
   * @param options   - Per-turn overrides (model, tools, system prompt, etc.)
   * @returns The agent's response and any tool calls made
   */
  run(
    agentId: string,
    messages: AgentMessage[],
    options?: AgentRunOptions,
  ): Promise<AgentRunResult>;

  /**
   * Check whether the runtime is healthy and can accept requests.
   * Returns a short status message, e.g. "ok" or "degraded: ...".
   */
  healthCheck(): Promise<string>;
}

// ---------------------------------------------------------------------------
// OpenClaw adapter (production default)
// ---------------------------------------------------------------------------

/**
 * Thin adapter that delegates to the OpenClaw plugin-sdk runtime.
 *
 * OpenClaw already handles the full agentic loop (tool calling, streaming,
 * session management). This adapter wraps the minimal subset needed to
 * satisfy the `AgentRuntime` interface for inter-agent `query` calls —
 * the primary use-case for the portability layer.
 *
 * For full conversation sessions (DM, group chat), OpenClaw continues
 * to own the dispatch loop as before. The runtime interface is mainly
 * used when the message bus needs to run a one-shot query against an
 * agent outside of a normal channel session.
 */
export class OpenClawRuntime implements AgentRuntime {
  readonly id = "openclaw";
  private apolloBaseUrl: string;
  private apiKey: string;

  constructor(opts?: { apolloBaseUrl?: string; apiKey?: string }) {
    this.apolloBaseUrl = opts?.apolloBaseUrl ?? process.env.SONANCE_APOLLO_BASE_URL ?? "";
    this.apiKey = opts?.apiKey ?? process.env.SONANCE_CORTEX_API_KEY ?? "";
  }

  async run(
    agentId: string,
    messages: AgentMessage[],
    options: AgentRunOptions = {},
  ): Promise<AgentRunResult> {
    if (!this.apolloBaseUrl) {
      return {
        text: `Apollo base URL not configured — cannot run agent "${agentId}" out-of-band. Set SONANCE_APOLLO_BASE_URL.`,
        toolCalls: [],
        stopReason: "error",
      };
    }

    // Strip "anthropic/" prefix — Apollo expects bare model names (e.g. "claude-sonnet-4-5-20250929")
    const model = (options.model ?? "claude-sonnet-4-6").replace(/^anthropic\//, "");

    const systemContent =
      messages.find((m) => m.role === "system")?.content ?? options.systemPrompt;
    const userMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model,
      messages: userMessages,
      max_tokens: options.maxTokens ?? 4096,
    };
    if (systemContent) {
      body.system = systemContent;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };
      if (this.apiKey) {
        headers["x-api-key"] = this.apiKey;
      }
      // Propagate user ID so Apollo can route to the user's own Anthropic key
      if (options.userId) {
        headers["x-cortex-user-id"] = options.userId;
      }

      const res = await fetch(`${this.apolloBaseUrl}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          text: `Apollo error calling agent "${agentId}": ${res.status} — ${text}`,
          toolCalls: [],
          stopReason: "error",
        };
      }

      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        stop_reason?: string;
        usage?: { input_tokens: number; output_tokens: number };
      };

      const text =
        data.content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("") ?? "";

      return {
        text,
        toolCalls: [],
        stopReason: data.stop_reason ?? "end_turn",
        ...(data.usage
          ? {
              usage: {
                promptTokens: data.usage.input_tokens,
                completionTokens: data.usage.output_tokens,
                totalTokens: data.usage.input_tokens + data.usage.output_tokens,
              },
            }
          : {}),
      };
    } catch (err) {
      return {
        text: `Runtime error calling agent "${agentId}": ${err instanceof Error ? err.message : String(err)}`,
        toolCalls: [],
        stopReason: "error",
      };
    }
  }

  async healthCheck(): Promise<string> {
    if (!this.apolloBaseUrl) {
      return "degraded: Apollo URL not configured";
    }
    try {
      const res = await fetch(`${this.apolloBaseUrl}/health`);
      return res.ok ? "ok" : `degraded: Apollo returned ${res.status}`;
    } catch (err) {
      return `degraded: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

// ---------------------------------------------------------------------------
// MockRuntime (for testing)
// ---------------------------------------------------------------------------

/**
 * Deterministic mock runtime for unit and integration tests.
 *
 * Responses can be pre-programmed per agent ID, or fall back to a default
 * echo response. Tool calls are never made.
 *
 * Usage:
 * ```ts
 * const mock = new MockRuntime();
 * mock.setResponse("scheduler", "Your meeting is booked for 3pm.");
 * setAgentRuntime(mock);
 * ```
 */
export class MockRuntime implements AgentRuntime {
  readonly id = "mock";
  private responses = new Map<string, string>();
  private callLog: Array<{ agentId: string; messages: AgentMessage[] }> = [];

  setResponse(agentId: string, response: string): void {
    this.responses.set(agentId, response);
  }

  getCallLog(): ReadonlyArray<{ agentId: string; messages: AgentMessage[] }> {
    return this.callLog;
  }

  clearCallLog(): void {
    this.callLog = [];
  }

  async run(
    agentId: string,
    messages: AgentMessage[],
    _options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    this.callLog.push({ agentId, messages });
    const lastUser = [...messages].toReversed().find((m) => m.role === "user");
    const text =
      this.responses.get(agentId) ??
      this.responses.get("*") ??
      `[MockRuntime] ${agentId}: ${lastUser?.content ?? "(no message)"}`;
    return { text, toolCalls: [], stopReason: "end_turn" };
  }

  async healthCheck(): Promise<string> {
    return "ok — mock runtime";
  }
}

// ---------------------------------------------------------------------------
// Global runtime registry
// ---------------------------------------------------------------------------

let _globalRuntime: AgentRuntime | null = null;

/**
 * Set the global agent runtime.
 * Call this once at startup (e.g. in sonance-cortex plugin registration).
 */
export function setAgentRuntime(runtime: AgentRuntime): void {
  _globalRuntime = runtime;
  console.log(`[platform] AgentRuntime set: ${runtime.id}`);
}

/**
 * Get the current global agent runtime.
 * Falls back to OpenClawRuntime if none has been set.
 */
export function getAgentRuntime(): AgentRuntime {
  if (!_globalRuntime) {
    _globalRuntime = new OpenClawRuntime();
  }
  return _globalRuntime;
}

/**
 * Reset the global runtime (useful in tests).
 */
export function resetAgentRuntime(): void {
  _globalRuntime = null;
}
