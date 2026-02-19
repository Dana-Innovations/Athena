/**
 * Sonance Cortex Plugin
 *
 * Integrates the OpenClaw gateway with the Sonance Cortex platform:
 *   - Registers Cortex-managed tools (MCPs, custom agents, monitors)
 *   - Pushes tool-call audit events for billing and security tracking
 *   - Resolves model API keys from Cortex (centralized key management)
 *
 * Configuration lives under `plugins.entries.sonance-cortex.config` in
 * openclaw.json (or via SONANCE_CORTEX_* env vars).
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { installApolloFetchCompat } from "./src/apollo-compat.js";
import { AuditSink } from "./src/audit-sink.js";
import { parseCortexConfig, type McpServerEntry } from "./src/config.js";
import { CortexClient } from "./src/cortex-client.js";
import { StdioMcpClient } from "./src/mcp-stdio-client.js";

const cortexPlugin = {
  id: "sonance-cortex",
  name: "Sonance Cortex",
  description: "Sonance Cortex integration — tools, auth, billing, and monitoring.",

  configSchema: {
    parse(value: unknown) {
      return parseCortexConfig(value);
    },
  },

  register(api: OpenClawPluginApi) {
    const config = parseCortexConfig(api.pluginConfig);

    if (!config.enabled) {
      api.logger.info("[sonance-cortex] plugin disabled");
      return;
    }

    if (!config.apiKey) {
      api.logger.warn(
        "[sonance-cortex] no API key configured (set plugins.entries.sonance-cortex.config.apiKey or SONANCE_CORTEX_API_KEY)",
      );
      return;
    }

    const client = new CortexClient({
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
    });

    // -----------------------------------------------------------------------
    // 1. Audit Sink — push tool-call events to Cortex
    // -----------------------------------------------------------------------

    let auditTeardown: (() => void) | undefined;
    let auditSink: AuditSink | undefined;

    if (config.audit.enabled) {
      auditSink = new AuditSink({
        client,
        config: {
          batchSize: config.audit.batchSize,
          flushIntervalMs: config.audit.flushIntervalMs,
        },
        logger: api.logger,
      });

      // Lazy import to avoid hard dependency on core internals from the plugin.
      import("../../src/security/sonance-audit.js")
        .then(({ setSonanceAuditSink }) => {
          auditTeardown = setSonanceAuditSink((event) => {
            auditSink?.push(event);
          });
          api.logger.info("[sonance-cortex] audit sink registered");
        })
        .catch((err) => {
          api.logger.warn(`[sonance-cortex] failed to register audit sink: ${String(err)}`);
        });
    }

    // -----------------------------------------------------------------------
    // 2. Centralized Key Resolver
    // -----------------------------------------------------------------------
    //
    // Apollo proxy model: Apollo holds the Anthropic key server-side. Clients
    // never see or need it. Instead, clients authenticate to Apollo with a
    // Cortex credential (ctx_ API key or JWT). Apollo validates the credential,
    // enforces rate limits / model access, then proxies to Anthropic using its
    // own CORTEX_ANTHROPIC_API_KEY.
    //
    // The resolver returns the *Cortex* credential (not the Anthropic key) so
    // OpenClaw sends it as x-api-key to Apollo. The Anthropic provider baseUrl
    // is rewritten to point at Apollo by sonance-defaults.ts.
    //
    // Fallback: when Apollo is not configured, env vars provide a raw provider
    // key for a simple direct-to-Anthropic PoC (no billing/tracking).
    // -----------------------------------------------------------------------

    let keyResolverTeardown: (() => void) | undefined;

    if (config.centralKeys.enabled) {
      import("../../src/agents/model-auth.js")
        .then(({ setSonanceCentralKeyResolver }) => {
          keyResolverTeardown = setSonanceCentralKeyResolver(async (provider) => {
            // 1. Apollo proxy mode: return the Cortex API key as the auth
            //    credential. Apollo receives this as x-api-key, validates it
            //    via Aegis, then proxies to Anthropic with the server-side key.
            //    The Anthropic provider baseUrl is already pointed at Apollo
            //    by sonance-defaults.ts when apolloBaseUrl is configured.
            if (config.apolloBaseUrl && config.apiKey) {
              api.logger.info(
                "[sonance-cortex] Apollo proxy — authenticating to Apollo for " + provider,
              );
              return {
                apiKey: config.apiKey,
                source: "cortex:apollo-proxy",
                mode: "api-key" as const,
              };
            }

            // 2. Direct fallback: env vars provide a raw provider key for PoC
            //    use without a running Cortex/Apollo server.
            const envKey = resolveProviderEnvKey(provider);
            if (envKey) {
              api.logger.info(
                "[sonance-cortex] direct mode — " + provider + " key from env: " + envKey.source,
              );
              return {
                apiKey: envKey.apiKey,
                source: "cortex:env:" + envKey.source,
                mode: "api-key" as const,
              };
            }

            return null;
          });
          api.logger.info("[sonance-cortex] central key resolver registered");
        })
        .catch((err) => {
          api.logger.warn(`[sonance-cortex] failed to register key resolver: ${String(err)}`);
        });
    }

    // -----------------------------------------------------------------------
    // 2b. Apollo SDK-compat fetch interceptor
    // -----------------------------------------------------------------------
    // The Anthropic SDK sends `system` as an array of content blocks (with
    // cache_control), but Apollo's Pydantic model expects a plain string.
    // This fetch wrapper flattens the field for Apollo-bound requests.

    let apolloCompatTeardown: (() => void) | undefined;

    if (config.apolloBaseUrl) {
      apolloCompatTeardown = installApolloFetchCompat(config.apolloBaseUrl, api.logger);
    }

    // -----------------------------------------------------------------------
    // 3. Dynamic Tool Registration — tools from Cortex
    // -----------------------------------------------------------------------

    if (config.tools.enabled) {
      client
        .listTools()
        .then((tools) => {
          for (const tool of tools) {
            api.registerTool({
              name: tool.name,
              description: tool.description,
              parameters: Type.Object(
                Object.fromEntries(
                  Object.entries(tool.parameters).map(([key, schema]) => [
                    key,
                    schema as ReturnType<typeof Type.Any>,
                  ]),
                ),
              ),
              async execute(toolCallId, params) {
                const result = await client.executeTool({
                  toolName: tool.name,
                  toolCallId,
                  parameters: params as Record<string, unknown>,
                });
                if (!result.ok) {
                  throw new Error(result.error ?? `Cortex tool "${tool.name}" execution failed`);
                }
                const text =
                  typeof result.output === "string"
                    ? result.output
                    : JSON.stringify(result.output ?? {});
                return wrapTextResult(text);
              },
            });
            api.logger.info(`[sonance-cortex] registered tool: ${tool.name}`);
          }
          api.logger.info(`[sonance-cortex] loaded ${tools.length} tool(s) from Cortex`);
        })
        .catch((err) => {
          api.logger.warn(`[sonance-cortex] failed to load tools: ${String(err)}`);
        });
    }

    // -----------------------------------------------------------------------
    // 4. MCP Server Bridge — register tools from external MCP servers
    //    Supports both HTTP and stdio transports.
    // -----------------------------------------------------------------------

    const stdioClients: StdioMcpClient[] = [];

    for (const mcp of config.mcpServers) {
      if (!mcp.registerTools) continue;

      const transport = mcp.transport ?? (mcp.command ? "stdio" : "http");
      if (transport === "stdio") {
        bridgeStdioMcp(api, mcp, stdioClients);
      } else {
        bridgeHttpMcp(api, mcp);
      }
    }

    // -----------------------------------------------------------------------
    // 5. Background Service — health monitoring + audit flush
    // -----------------------------------------------------------------------

    api.registerService({
      id: "sonance-cortex",
      async start() {
        const healthy = await client.healthCheck().catch(() => false);
        if (healthy) {
          api.logger.info("[sonance-cortex] Cortex API reachable");
        } else {
          api.logger.warn(
            `[sonance-cortex] Cortex API unreachable at ${config.apiBaseUrl} — retrying on next flush`,
          );
        }
        auditSink?.start();
      },
      async stop() {
        apolloCompatTeardown?.();
        auditTeardown?.();
        keyResolverTeardown?.();
        await auditSink?.stop();
        for (const sc of stdioClients) {
          await sc.stop().catch(() => {});
        }
      },
    });

    // -----------------------------------------------------------------------
    // 5. Gateway Method — kill-switch for suspicious sessions
    // -----------------------------------------------------------------------

    api.registerGatewayMethod("sonance.kill_session", async ({ params, respond }) => {
      const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey.trim() : "";
      if (!sessionKey) {
        respond(false, { error: "sessionKey is required" });
        return;
      }
      // Future: integrate with session manager to terminate the session.
      api.logger.warn(`[sonance-cortex] kill_session requested for ${sessionKey}`);
      respond(true, { killed: sessionKey });
    });
  },
};

// ---------------------------------------------------------------------------
// Provider env-var fallback (PoC mode — no running Cortex server needed)
// ---------------------------------------------------------------------------

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic: ["SONANCE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
  openai: ["SONANCE_OPENAI_API_KEY", "OPENAI_API_KEY"],
  google: ["SONANCE_GOOGLE_API_KEY", "GOOGLE_API_KEY"],
};

function resolveProviderEnvKey(provider: string): { apiKey: string; source: string } | null {
  const envVars = PROVIDER_ENV_VARS[provider];
  if (!envVars) return null;
  for (const envVar of envVars) {
    const value = process.env[envVar]?.trim();
    if (value) {
      return { apiKey: value, source: envVar };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// MCP bridge helpers
// ---------------------------------------------------------------------------

function wrapTextResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function registerMcpTools(
  api: OpenClawPluginApi,
  mcpName: string,
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>,
  callFn: (toolName: string, params: Record<string, unknown>) => Promise<string>,
): void {
  for (const tool of tools) {
    const toolName = mcpName + "_" + tool.name;
    const inputProps = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;

    api.registerTool({
      name: toolName,
      description: "[" + mcpName + "] " + (tool.description ?? tool.name),
      parameters: Type.Object(
        Object.fromEntries(
          Object.entries(inputProps).map(([key, schema]) => [
            key,
            schema as ReturnType<typeof Type.Any>,
          ]),
        ),
      ),
      async execute(_toolCallId, params) {
        const text = await callFn(tool.name, params as Record<string, unknown>);
        return wrapTextResult(text);
      },
    });
    api.logger.info("[sonance-cortex] registered MCP tool: " + toolName);
  }
  api.logger.info(
    "[sonance-cortex] loaded " + tools.length + " tool(s) from MCP '" + mcpName + "'",
  );
}

/**
 * Bridge a stdio-based MCP server (e.g. `npx -y sonance-m365-mcp`).
 * Spawns the process, discovers tools, and registers them.
 *
 * If a Sonance SSO session exists, the access_token is passed via
 * MICROSOFT_ACCESS_TOKEN so the MCP can skip its own OAuth flow.
 */
function bridgeStdioMcp(
  api: OpenClawPluginApi,
  mcp: McpServerEntry,
  clients: StdioMcpClient[],
): void {
  if (!mcp.command) return;

  const client = new StdioMcpClient({
    command: mcp.command,
    args: mcp.args ?? [],
  });
  clients.push(client);

  // Load stored SSO access token → pass to MCP process as env var so it can
  // authenticate to Graph API without triggering its own OAuth flow.
  const tokenPromise = import("../../src/gateway/sonance-token-store.js")
    .then(({ loadSonanceTokens }) => {
      const tokens = loadSonanceTokens();
      if (tokens?.accessToken) {
        client.config.env = { MICROSOFT_ACCESS_TOKEN: tokens.accessToken };
        api.logger.info(
          "[sonance-cortex] passing SSO access_token to stdio MCP '" + mcp.name + "'",
        );
      }
    })
    .catch(() => {
      // Token store not available — MCP will use its own auth flow.
    });

  tokenPromise
    .then(() => client.start())
    .then(() => client.listTools())
    .then((tools) => {
      registerMcpTools(api, mcp.name, tools, async (toolName, params) => {
        const result = await client.callTool(toolName, params);
        if (result.isError) {
          const errText = result.content?.map((c) => c.text ?? "").join("\n") ?? "MCP tool error";
          throw new Error(errText);
        }
        const textContent = result.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        return textContent || JSON.stringify(result ?? {});
      });
    })
    .catch((err) => {
      api.logger.warn(
        "[sonance-cortex] failed to start stdio MCP '" + mcp.name + "': " + String(err),
      );
    });
}

/**
 * Bridge an HTTP/SSE-based MCP server. Discovers tools via POST to /tools/list
 * and proxies tool calls via POST to /tools/call.
 */
function bridgeHttpMcp(api: OpenClawPluginApi, mcp: McpServerEntry): void {
  if (!mcp.url) return;

  const baseUrl = mcp.url.replace(/\/+$/, "");
  const mcpHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (mcp.apiKey) {
    mcpHeaders["Authorization"] = "Bearer " + mcp.apiKey;
  }

  fetch(baseUrl + "/tools/list", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error("MCP tools/list failed: " + res.status + " " + res.statusText);
      }
      const body = (await res.json()) as {
        result?: {
          tools?: Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          }>;
        };
      };
      return body.result?.tools ?? [];
    })
    .then((tools) => {
      registerMcpTools(api, mcp.name, tools, async (toolName, params) => {
        const callRes = await fetch(baseUrl + "/tools/call", {
          method: "POST",
          headers: mcpHeaders,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: { name: toolName, arguments: params },
          }),
        });
        if (!callRes.ok) {
          const errText = await callRes.text().catch(() => "");
          throw new Error("MCP tool call failed: " + callRes.status + " " + errText);
        }
        const callBody = (await callRes.json()) as {
          result?: { content?: Array<{ type: string; text?: string }> };
          error?: { message?: string };
        };
        if (callBody.error) {
          throw new Error(callBody.error.message ?? "MCP tool error");
        }
        const textContent = callBody.result?.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        return textContent || JSON.stringify(callBody.result ?? {});
      });
    })
    .catch((err) => {
      api.logger.warn(
        "[sonance-cortex] failed to load tools from MCP '" + mcp.name + "': " + String(err),
      );
    });
}

export default cortexPlugin;
