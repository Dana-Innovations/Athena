/**
 * Sonance Cortex Plugin Configuration
 */

export type McpServerEntry = {
  /** Display name for this MCP server. */
  name: string;
  /**
   * Transport type: "http" for HTTP/SSE, "stdio" for stdin/stdout JSON-RPC.
   * @default "http" if `url` is set, "stdio" if `command` is set.
   */
  transport?: "http" | "stdio";
  /** MCP server URL (HTTP/SSE transport). */
  url?: string;
  /** Command to spawn the MCP server process (stdio transport). */
  command?: string;
  /** Arguments for the stdio command. */
  args?: string[];
  /** Optional API key or Bearer token (HTTP transport). */
  apiKey?: string;
  /** Whether to register this MCP's tools with the agent. */
  registerTools?: boolean;
};

export type SonanceCortexConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  /**
   * Apollo proxy base URL. When set, the central key resolver returns the
   * Cortex API key for provider auth and OpenClaw should be configured to
   * route model requests through this URL (set `models.providers.anthropic.baseUrl`
   * in `openclaw.json` to this value).
   *
   * Example: "http://localhost:8000" (local Cortex with SDK-compat routes).
   */
  apolloBaseUrl: string;
  /**
   * CompositeMCPBridge URL. When set, the plugin discovers and registers all
   * Cortex-aggregated MCP tools via a single JSON-RPC 2.0 endpoint.
   *
   * Example: "http://localhost:8000/mcp/cortex"
   */
  mcpBridgeUrl: string;
  audit: {
    enabled: boolean;
    batchSize: number;
    flushIntervalMs: number;
  };
  centralKeys: {
    enabled: boolean;
  };
  tools: {
    enabled: boolean;
  };
  /** External MCP servers to bridge (tools are registered via the plugin API). */
  mcpServers: McpServerEntry[];
};

function parseMcpServers(raw: unknown): McpServerEntry[] {
  if (!Array.isArray(raw)) return [];
  const results: McpServerEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;
    const url = typeof obj.url === "string" ? obj.url.trim() : undefined;
    const command = typeof obj.command === "string" ? obj.command.trim() : undefined;
    if (!url && !command) continue;
    const transport =
      obj.transport === "stdio" || obj.transport === "http"
        ? obj.transport
        : command
          ? "stdio"
          : "http";
    results.push({
      name,
      transport,
      url,
      command,
      args: Array.isArray(obj.args)
        ? obj.args.filter((a): a is string => typeof a === "string")
        : undefined,
      apiKey: typeof obj.apiKey === "string" ? obj.apiKey.trim() : undefined,
      registerTools: typeof obj.registerTools === "boolean" ? obj.registerTools : true,
    });
  }
  return results;
}

export function parseCortexConfig(raw: unknown): SonanceCortexConfig {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const audit = (obj.audit ?? {}) as Record<string, unknown>;
  const centralKeys = (obj.centralKeys ?? {}) as Record<string, unknown>;
  const tools = (obj.tools ?? {}) as Record<string, unknown>;

  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
    apiBaseUrl:
      typeof obj.apiBaseUrl === "string" && obj.apiBaseUrl.trim()
        ? obj.apiBaseUrl.trim()
        : (process.env.SONANCE_CORTEX_API_URL ?? "http://localhost:8900"),
    apiKey:
      typeof obj.apiKey === "string" && obj.apiKey.trim()
        ? obj.apiKey.trim()
        : (process.env.SONANCE_CORTEX_API_KEY ?? ""),
    apolloBaseUrl:
      typeof obj.apolloBaseUrl === "string" && obj.apolloBaseUrl.trim()
        ? obj.apolloBaseUrl.trim()
        : (process.env.SONANCE_APOLLO_BASE_URL ?? ""),
    mcpBridgeUrl:
      typeof obj.mcpBridgeUrl === "string" && obj.mcpBridgeUrl.trim()
        ? obj.mcpBridgeUrl.trim()
        : (process.env.SONANCE_MCP_BRIDGE_URL ?? ""),
    audit: {
      enabled: typeof audit.enabled === "boolean" ? audit.enabled : true,
      batchSize: typeof audit.batchSize === "number" ? audit.batchSize : 50,
      flushIntervalMs: typeof audit.flushIntervalMs === "number" ? audit.flushIntervalMs : 5000,
    },
    centralKeys: {
      enabled: typeof centralKeys.enabled === "boolean" ? centralKeys.enabled : true,
    },
    tools: {
      enabled: typeof tools.enabled === "boolean" ? tools.enabled : true,
    },
    mcpServers: parseMcpServers(obj.mcpServers),
  };
}
