/**
 * Cortex Tools Plugin for Athena.
 *
 * Discovers and registers all Cortex tools (GitHub, Supabase, Vercel,
 * code analysis, security scanning, etc.) as native Athena agent tools.
 *
 * NOTE: Athena's plugin loader does NOT await async register() functions.
 * Tool discovery is done synchronously via a child process to ensure
 * tools are registered before the agent run begins.
 *
 * Configuration (in athena.json or via env vars):
 *   plugins.cortex-tools.url    = "https://cortex.example.com"  (or CORTEX_URL)
 *   plugins.cortex-tools.apiKey = "ctx_..."                     (or CORTEX_API_KEY)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "../../src/plugins/types.js";
import { syncCortexAgents } from "./src/agent-sync.js";
import { CortexClient } from "./src/client.js";
import type { CortexTool } from "./src/client.js";
import { createCortexAgentTool } from "./src/tool-adapter.js";
import { UserTokenManager } from "./src/user-token-manager.js";

type CortexPluginConfig = {
  url?: string;
  apiKey?: string;
};

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachePath(): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR
    ? path.resolve(process.env.OPENCLAW_STATE_DIR)
    : path.join(os.homedir(), ".athena");
  return path.join(stateDir, "cortex-tools-cache.json");
}

function readCachedTools(): CortexTool[] | null {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return null;
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (Array.isArray(data) && data.length > 0) return data as CortexTool[];
    return null;
  } catch {
    return null;
  }
}

/** Read the cache without TTL check (for display-only endpoints). */
function readCachedToolsAnyAge(): CortexTool[] | null {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (Array.isArray(data) && data.length > 0) return data as CortexTool[];
    return null;
  } catch {
    return null;
  }
}

function writeCachedTools(tools: CortexTool[]): void {
  try {
    const cachePath = getCachePath();
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(tools), "utf-8");
  } catch {
    // Best effort
  }
}

/**
 * Synchronously fetch tool schemas from Cortex by spawning a child Node process.
 * This is necessary because Athena's plugin loader does not await async register().
 */
function fetchToolsSync(cortexUrl: string, apiKey: string): CortexTool[] | null {
  const script = [
    "const url = process.env.__CORTEX_DISCOVER_URL;",
    "const key = process.env.__CORTEX_DISCOVER_KEY;",
    "fetch(url, { headers: { 'X-API-Key': key } })",
    "  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })",
    "  .then(d => {",
    "    const tools = Array.isArray(d) ? d : d.tools;",
    "    process.stdout.write(JSON.stringify(tools.map(t => ({",
    "      name: t.name,",
    "      description: t.description,",
    "      inputSchema: t.input_schema",
    "    }))));",
    "  })",
    "  .catch(e => { process.stderr.write(e.message); process.exit(1); });",
  ].join("\n");

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    timeout: 15000,
    env: {
      ...process.env,
      __CORTEX_DISCOVER_URL: `${cortexUrl.replace(/\/+$/, "")}/api/v1/tools/schemas`,
      __CORTEX_DISCOVER_KEY: apiKey,
    },
  });

  if (result.status !== 0) return null;
  try {
    const tools = JSON.parse(result.stdout);
    return Array.isArray(tools) ? tools : null;
  } catch {
    return null;
  }
}

const plugin = {
  id: "cortex-tools",
  name: "Cortex Tools",
  description:
    "Connects to Cortex backend and exposes all tools (GitHub, Supabase, Vercel, etc.) as native Athena agent tools",

  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as CortexPluginConfig;
    const cortexUrl = pluginConfig.url ?? process.env.CORTEX_URL ?? "";
    const cortexApiKey = pluginConfig.apiKey ?? process.env.CORTEX_API_KEY ?? "";

    if (!cortexUrl || !cortexApiKey) {
      api.logger.warn(
        "Cortex Tools: Missing url or apiKey. Set plugins.cortex-tools.url " +
          "and plugins.cortex-tools.apiKey in config, or CORTEX_URL and CORTEX_API_KEY env vars.",
      );
      return;
    }

    api.logger.info(`Cortex Tools: connecting to ${cortexUrl}`);

    // Try cache first, then synchronous fetch
    let tools = readCachedTools();
    if (tools) {
      api.logger.info(`Cortex Tools: loaded ${tools.length} tools from cache`);
    } else {
      api.logger.info("Cortex Tools: discovering tools from Cortex...");
      tools = fetchToolsSync(cortexUrl, cortexApiKey);
      if (tools) {
        api.logger.info(`Cortex Tools: discovered ${tools.length} tools`);
        writeCachedTools(tools);
      } else {
        // Live discovery failed — try expired cache as last resort
        tools = readCachedToolsAnyAge();
        if (tools) {
          api.logger.warn(
            `Cortex Tools: live discovery failed, using stale cache (${tools.length} tools)`,
          );
        } else {
          api.logger.error(
            `Cortex Tools: failed to discover tools from ${cortexUrl} and no cache available. Is Cortex running?`,
          );
          return;
        }
      }
    }

    // Create the HTTP client for tool execution (used at call time)
    const client = new CortexClient(cortexUrl, cortexApiKey);

    // Create per-user token manager for SSO-based user resolution
    const tokenManager = new UserTokenManager(cortexUrl, cortexApiKey);

    // Track registered tool names so cortex.sync can add new ones at runtime
    const registeredToolNames = new Set<string>();

    // Register each tool as a factory so it receives sessionKey at execution time.
    // This enables per-user API key resolution via Sonance SSO identity.
    let registered = 0;
    for (const tool of tools) {
      try {
        api.registerTool((ctx: OpenClawPluginToolContext) => {
          return createCortexAgentTool(
            tool,
            client,
            tokenManager,
            ctx.sessionKey,
          ) as unknown as AnyAgentTool;
        });
        registeredToolNames.add(tool.name);
        registered++;
      } catch (err) {
        api.logger.warn(
          `Cortex Tools: failed to register tool ${tool.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    api.logger.info(
      `Cortex Tools: registered ${registered}/${tools.length} tools (factory pattern)`,
    );

    // Auto-generate one agent per MCP with tool documentation
    try {
      syncCortexAgents(tools, api.logger);
    } catch (err) {
      api.logger.warn(
        `Cortex Tools: agent sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Gateway method for runtime MCP re-discovery (called by UI Refresh button)
    const schemasUrl = `${cortexUrl.replace(/\/+$/, "")}/api/v1/tools/schemas`;
    api.registerGatewayMethod("cortex.sync", async (opts) => {
      try {
        const res = await fetch(schemasUrl, {
          headers: { "X-API-Key": cortexApiKey },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Record<string, unknown>;
        const rawTools = (
          Array.isArray(data) ? data : (data as { tools: unknown[] }).tools
        ) as Record<string, unknown>[];
        const freshTools: CortexTool[] = rawTools.map((t) => ({
          name: String(t.name),
          description: String(t.description ?? ""),
          inputSchema: ((t.input_schema ?? t.inputSchema) as Record<string, unknown>) || {},
        }));

        writeCachedTools(freshTools);

        // Register tools not yet known to the plugin registry
        let newToolCount = 0;
        for (const tool of freshTools) {
          if (!registeredToolNames.has(tool.name)) {
            try {
              api.registerTool((ctx: OpenClawPluginToolContext) => {
                return createCortexAgentTool(
                  tool,
                  client,
                  tokenManager,
                  ctx.sessionKey,
                ) as unknown as AnyAgentTool;
              });
              registeredToolNames.add(tool.name);
              newToolCount++;
            } catch {
              // skip individual tool failures
            }
          }
        }

        syncCortexAgents(freshTools, api.logger);

        api.logger.info(
          `Cortex Tools: sync complete — ${freshTools.length} tools, ${newToolCount} newly registered`,
        );
        opts.respond(true, {
          totalTools: freshTools.length,
          newToolsRegistered: newToolCount,
        });
      } catch (err) {
        const message = `Cortex sync failed: ${err instanceof Error ? err.message : String(err)}`;
        api.logger.warn(`Cortex Tools: ${message}`);
        opts.respond(false, undefined, { code: "CORTEX_SYNC_FAILED", message });
      }
    });

    // Gateway method to list registered Cortex tools grouped by MCP (for UI display)
    api.registerGatewayMethod("cortex.tools.list", (opts) => {
      const cached = readCachedToolsAnyAge();
      if (!cached) {
        opts.respond(true, { groups: [] });
        return;
      }
      const map = new Map<string, { name: string; shortName: string; description: string }[]>();
      for (const tool of cached) {
        const sep = tool.name.indexOf("__");
        if (sep === -1) continue;
        const mcpName = tool.name.slice(0, sep);
        const shortName = tool.name.slice(sep + 2);
        let list = map.get(mcpName);
        if (!list) {
          list = [];
          map.set(mcpName, list);
        }
        list.push({
          name: `cortex_${tool.name}`,
          shortName,
          description: tool.description,
        });
      }
      const groups = Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mcpName, tools]) => ({
          mcpName,
          displayName: mcpName
            .split(/[-_]/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          tools,
        }));
      opts.respond(true, { groups });
    });

    // Gateway method to list MCP connections (company defaults visible to all)
    const connectionsUrl = `${cortexUrl.replace(/\/+$/, "")}/api/v1/oauth/connections`;
    api.registerGatewayMethod("cortex.connections.list", async (opts) => {
      try {
        // Resolve per-user API key if SSO context is available
        let apiKey = cortexApiKey;
        const sessionKey = opts.client?.connect?.client?.instanceId;
        if (sessionKey) {
          try {
            const { getSonanceSessionUser } = await import("../../src/gateway/sonance-context.js");
            const user = getSonanceSessionUser(sessionKey);
            if (user?.email) {
              apiKey = await tokenManager.getKeyForUser(user.email);
            }
          } catch {
            // Fall back to service key
          }
        }

        const res = await fetch(connectionsUrl, {
          headers: { "X-API-Key": apiKey },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Record<string, unknown>;
        opts.respond(true, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn(`Cortex Tools: connections list failed: ${message}`);
        opts.respond(true, { connections: [] });
      }
    });

    // Gateway method to initiate an OAuth flow for an MCP
    const oauthBaseUrl = `${cortexUrl.replace(/\/+$/, "")}/api/v1/oauth`;
    api.registerGatewayMethod("cortex.oauth.initiate", async (opts) => {
      const params = (opts.req.params ?? {}) as {
        provider?: string;
        mcpName?: string;
        redirectUri?: string;
      };
      const { provider, mcpName, redirectUri } = params;

      if (!provider || !mcpName) {
        opts.respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "provider and mcpName are required",
        });
        return;
      }

      // MCP names that differ from their OAuth provider name
      const MCP_TO_OAUTH_PROVIDER: Record<string, string> = {
        m365: "microsoft",
      };
      const oauthProvider = MCP_TO_OAUTH_PROVIDER[provider] ?? provider;

      // Auto-derive redirect URI from Cortex URL if not provided
      const resolvedRedirectUri =
        redirectUri ?? `${cortexUrl.replace(/\/+$/, "")}/api/v1/oauth/${oauthProvider}/callback`;

      try {
        // Resolve per-user API key
        let apiKey = cortexApiKey;
        const sessionKey = opts.client?.connect?.client?.instanceId;
        if (sessionKey) {
          try {
            const { getSonanceSessionUser } = await import("../../src/gateway/sonance-context.js");
            const user = getSonanceSessionUser(sessionKey);
            if (user?.email) {
              apiKey = await tokenManager.getKeyForUser(user.email);
            }
          } catch {
            // Fall back to service key
          }
        }

        const res = await fetch(`${oauthBaseUrl}/${oauthProvider}/initiate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            mcp_name: mcpName,
            redirect_uri: resolvedRedirectUri,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const data = (await res.json()) as Record<string, unknown>;
        opts.respond(true, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn(`Cortex Tools: OAuth initiate failed: ${message}`);
        opts.respond(false, undefined, {
          code: "OAUTH_INITIATE_FAILED",
          message,
        });
      }
    });

    // Gateway method for headless MCP tool execution (used by Dashboard)
    api.registerGatewayMethod("cortex.tools.execute", async (opts) => {
      const params = (opts.req.params ?? {}) as {
        toolName?: string;
        args?: Record<string, unknown>;
      };
      const { toolName, args } = params;

      if (!toolName) {
        opts.respond(false, undefined, {
          code: "INVALID_PARAMS",
          message: "toolName is required",
        });
        return;
      }

      try {
        // Resolve per-user API key if SSO context is available
        let apiKey = cortexApiKey;
        const sessionKey = opts.client?.connect?.client?.instanceId;
        if (sessionKey) {
          try {
            const { getSonanceSessionUser } = await import("../../src/gateway/sonance-context.js");
            const user = getSonanceSessionUser(sessionKey);
            if (user?.email) {
              apiKey = await tokenManager.getKeyForUser(user.email);
            }
          } catch {
            // Fall back to service key
          }
        }

        const result = await client.callTool(toolName, args ?? {}, apiKey);
        // Unwrap ToolExecutionResult envelope — dashboard widgets expect raw
        // tool output, not the {success, data, execution_time_ms} wrapper.
        opts.respond(true, result.data ?? result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn(`Cortex Tools: headless execute failed: ${message}`);
        opts.respond(false, undefined, {
          code: "TOOL_EXECUTE_FAILED",
          message,
        });
      }
    });
  },
};

export default plugin;
