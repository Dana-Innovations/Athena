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
          Authorization: `Bearer ${this.apiKey}`,
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
    return this.request<CortexTool[]>("/api/v1/tools");
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
      await this.request<{ ok: boolean }>("/api/v1/health");
      return true;
    } catch {
      return false;
    }
  }
}
