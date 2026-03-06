/**
 * HTTP client for communicating with Cortex's REST API.
 *
 * Uses:
 *   GET  /api/v1/tools/schemas   — discover all available tools
 *   POST /mcp/cortex             — execute a tool (JSON-RPC via MCP bridge)
 *
 * Tool execution routes through the MCP bridge rather than the HERMES REST
 * endpoint because the bridge calls resolve_mcp_token() to look up per-user
 * OAuth tokens (e.g. M365). The REST endpoint at /api/v1/tools/ does not.
 */

export type CortexTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type CortexToolCallResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  error_code?: string;
  execution_time_ms?: number;
};

export class CortexClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  /**
   * Verify the Cortex instance is reachable.
   * Returns the health status.
   */
  async healthCheck(): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: { "X-API-Key": this.apiKey },
    });
    return response.ok;
  }

  /**
   * Discover all tools from the Cortex REST API.
   * Maps the REST response (input_schema) to the CortexTool type (inputSchema).
   */
  async listTools(): Promise<CortexTool[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/tools/schemas`, {
      headers: {
        "X-API-Key": this.apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cortex tool discovery failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as
      | {
          tools: Array<{
            name: string;
            description: string;
            input_schema: Record<string, unknown>;
          }>;
        }
      | Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;

    const tools = Array.isArray(json) ? json : json.tools;

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema,
    }));
  }

  /**
   * Execute a tool via the Cortex MCP bridge (JSON-RPC at /mcp/cortex).
   *
   * Tool names are in the format `{mcp_name}__{tool_name}` (e.g. `github__list_repositories`).
   * The bridge resolves per-user OAuth tokens from mcp_connections, which is
   * required for OAuth-based MCPs like M365.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    apiKeyOverride?: string,
  ): Promise<CortexToolCallResult> {
    const response = await fetch(`${this.baseUrl}/mcp/cortex`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKeyOverride ?? this.apiKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cortex tool execution failed (${response.status}): ${text}`);
    }

    const body = (await response.json()) as {
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      error?: { code?: number; message?: string };
    };

    if (body.error) {
      return {
        success: false,
        error: body.error.message ?? "MCP bridge error",
        error_code: body.error.code ? String(body.error.code) : undefined,
      };
    }

    const content = body.result?.content ?? [];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");

    if (body.result?.isError) {
      return { success: false, error: text || "Tool returned an error" };
    }

    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON — keep as string
    }

    return { success: true, data };
  }
}
