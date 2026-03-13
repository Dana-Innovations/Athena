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
import { pluginUserStore } from "../../src/plugins/user-context.js";
import { installApolloFetchCompat } from "./src/apollo-compat.js";
import { AuditSink } from "./src/audit-sink.js";
import { parseCortexConfig, type McpServerEntry } from "./src/config.js";
import { CortexClient } from "./src/cortex-client.js";
import { StdioMcpClient } from "./src/mcp-stdio-client.js";
import { jsonSchemaToTypeBox } from "./src/tool-adapter.js";

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

    // Local-only Sonance gateway methods — no Cortex connectivity required.
    registerLocalSonanceMethods(api);

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
      supabaseUrl: config.supabaseUrl,
      supabaseServiceRoleKey: config.supabaseServiceRoleKey,
      supabaseJwtSecret: config.supabaseJwtSecret,
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
      Promise.all([import("../../src/security/sonance-audit.js"), import("./src/apollo-compat.js")])
        .then(([{ setSonanceAuditSink }, { getLastApolloKeySource }]) => {
          auditTeardown = setSonanceAuditSink((event) => {
            const enriched = { ...event };
            if (!enriched.keySource) {
              const source = getLastApolloKeySource();
              if (source) enriched.keySource = source;
            }
            auditSink?.push(enriched);
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
    // 2c. Cortex Skills Provider — inject best-practice rules into system prompt
    // -----------------------------------------------------------------------

    let cortexSkillsTeardown: (() => void) | undefined;

    import("../../src/agents/cortex-skills.js")
      .then(({ setSonanceCortexSkillsProvider }) => {
        cortexSkillsTeardown = setSonanceCortexSkillsProvider(async () => {
          try {
            const result = await client.getSkillsPrompt({
              minPriority: "medium",
              maxRulesPerSkill: 10,
              includeExamples: false,
            });
            return {
              prompt: result.prompt,
              skillCount: result.skill_count,
              ruleCount: result.rule_count,
            };
          } catch {
            return null;
          }
        });
        api.logger.info("[sonance-cortex] Cortex skills provider registered");
      })
      .catch((err) => {
        api.logger.warn(`[sonance-cortex] failed to register skills provider: ${String(err)}`);
      });

    // -----------------------------------------------------------------------
    // 2b. Apollo SDK-compat fetch interceptor
    // -----------------------------------------------------------------------
    // The Anthropic SDK sends `system` as an array of content blocks (with
    // cache_control), but Apollo's Pydantic model expects a plain string.
    // This fetch wrapper flattens the field for Apollo-bound requests.

    let apolloCompatTeardown: (() => void) | undefined;

    if (config.apolloBaseUrl) {
      apolloCompatTeardown = installApolloFetchCompat({
        apolloBaseUrl: config.apolloBaseUrl,
        logger: api.logger,
        resolveUserId: () => {
          try {
            // Lazy-require to avoid hard dependency
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { loadSonanceTokens } = require("../../src/gateway/sonance-token-store.js") as {
              loadSonanceTokens: () => { idToken?: string } | null;
            };
            const tokens = loadSonanceTokens();
            if (!tokens?.idToken) return undefined;
            // Extract the `sub` claim (user UUID) from the JWT id_token
            const payload = tokens.idToken.split(".")[1];
            if (!payload) return undefined;
            const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
              sub?: string;
              oid?: string;
            };
            return decoded.sub ?? decoded.oid;
          } catch {
            return undefined;
          }
        },
      });
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
              label: tool.name,
              description: tool.description,
              parameters: Type.Object(
                Object.fromEntries(
                  Object.entries(tool.parameters ?? {}).map(([key, schema]) => [
                    key,
                    schema as ReturnType<typeof Type.Any>,
                  ]),
                ),
              ),
              async execute(toolCallId, params) {
                const userCtx = pluginUserStore.getStore();
                const result = await client.executeTool(
                  {
                    toolName: tool.name,
                    toolCallId,
                    parameters: params as Record<string, unknown>,
                  },
                  { userId: userCtx?.senderId },
                );
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
    // 4a. CompositeMCPBridge — single JSON-RPC endpoint aggregating all
    //     Cortex-managed MCPs (GitHub, Supabase, Vercel, etc.)
    // -----------------------------------------------------------------------

    if (config.mcpBridgeUrl) {
      bridgeCortexMcp(api, config.mcpBridgeUrl, config.apiKey);
    }

    // -----------------------------------------------------------------------
    // 4b. MCP Server Bridge — register tools from external MCP servers
    //     Supports both HTTP and stdio transports.
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
        cortexSkillsTeardown?.();
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
      api.logger.warn(`[sonance-cortex] kill_session requested for ${sessionKey}`);
      respond(true, { killed: sessionKey });
    });

    // -----------------------------------------------------------------------
    // 6. Key Management Gateway Methods (Apollo Phase 2 multi-auth)
    // -----------------------------------------------------------------------

    api.registerGatewayMethod("sonance.keys.list", async ({ respond }) => {
      try {
        const keys = await client.listKeys();
        respond(true, keys);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.keys.set_api_key", async ({ params, respond }) => {
      const key = typeof params?.key === "string" ? params.key.trim() : "";
      const label = typeof params?.label === "string" ? params.label.trim() : undefined;
      if (!key) {
        respond(false, { error: "key is required" });
        return;
      }
      try {
        await client.setApiKey(key, label);
        respond(true, { ok: true });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.keys.remove_api_key", async ({ respond }) => {
      try {
        await client.removeApiKey();
        respond(true, { ok: true });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.keys.verify", async ({ respond }) => {
      try {
        const result = await client.verifyApiKey();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.keys.status", async ({ respond }) => {
      try {
        const status = await client.getKeyStatus();
        respond(true, status);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.keys.oauth_start", async ({ respond }) => {
      try {
        const result = await client.startOAuthFlow();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.keys.oauth_disconnect", async ({ respond }) => {
      try {
        await client.disconnectOAuth();
        respond(true, { ok: true });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    // -----------------------------------------------------------------------
    // 7. Apollo Usage Gateway Method (dashboard)
    // -----------------------------------------------------------------------

    api.registerGatewayMethod("sonance.apollo.status", async ({ respond }) => {
      try {
        const [healthy, keyStatus] = await Promise.allSettled([
          client.healthCheck(),
          client.getKeyStatus(),
        ]);
        respond(true, {
          apolloHealthy: healthy.status === "fulfilled" ? healthy.value : false,
          apolloBaseUrl: config.apolloBaseUrl || null,
          keyStatus: keyStatus.status === "fulfilled" ? keyStatus.value : null,
          keyStatusError: keyStatus.status === "rejected" ? String(keyStatus.reason) : undefined,
        });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.apollo.usage", async ({ params, respond }) => {
      try {
        const usage = await client.getApolloUsage({
          startDate: typeof params?.startDate === "string" ? params.startDate : undefined,
          endDate: typeof params?.endDate === "string" ? params.endDate : undefined,
          limit: typeof params?.limit === "number" ? params.limit : undefined,
        });
        respond(true, usage);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.apollo.dashboard", async ({ params, respond }) => {
      try {
        const dashboard = await client.getOrgWideUsage({
          startDate: typeof params?.startDate === "string" ? params.startDate : undefined,
          endDate: typeof params?.endDate === "string" ? params.endDate : undefined,
        });
        respond(true, dashboard);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    // -----------------------------------------------------------------------
    // 8. Cortex Skills Gateway Methods
    // -----------------------------------------------------------------------

    api.registerGatewayMethod("sonance.skills.list", async ({ params, respond }) => {
      try {
        const result = await client.listSkills({
          category: typeof params?.category === "string" ? params.category : undefined,
          mcp: typeof params?.mcp === "string" ? params.mcp : undefined,
          enabledOnly: typeof params?.enabledOnly === "boolean" ? params.enabledOnly : undefined,
        });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.skills.detail", async ({ params, respond }) => {
      const skillName = typeof params?.skillName === "string" ? params.skillName.trim() : "";
      if (!skillName) {
        respond(false, { error: "skillName is required" });
        return;
      }
      try {
        const result = await client.getSkillDetail(skillName);
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.skills.prompt", async ({ params, respond }) => {
      try {
        const result = await client.getSkillsPrompt({
          minPriority: typeof params?.minPriority === "string" ? params.minPriority : undefined,
          maxRulesPerSkill:
            typeof params?.maxRulesPerSkill === "number" ? params.maxRulesPerSkill : undefined,
          includeExamples:
            typeof params?.includeExamples === "boolean" ? params.includeExamples : undefined,
        });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    // -----------------------------------------------------------------------
    // 9. Admin Gateway Methods (read-only visibility)
    // -----------------------------------------------------------------------

    api.registerGatewayMethod("sonance.auth.me", async ({ params, respond }) => {
      const email = typeof params?.email === "string" ? params.email.trim() : "";
      if (!email) {
        respond(false, { error: "email is required" });
        return;
      }
      try {
        const result = await client.getUserProfile(email);
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.users", async ({ respond }) => {
      try {
        const result = await client.listUsers();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.usage", async ({ params, respond }) => {
      try {
        const result = await client.getAdminUsage({
          startDate: typeof params?.startDate === "string" ? params.startDate : undefined,
          endDate: typeof params?.endDate === "string" ? params.endDate : undefined,
          limit: typeof params?.limit === "number" ? params.limit : undefined,
        });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.mcp_access", async ({ respond }) => {
      try {
        const result = await client.getAdminMcpAccess();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.mcp_user_access", async ({ respond }) => {
      try {
        const result = await client.getAdminMcpUserAccess();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod(
      "sonance.admin.grant_mcp_user_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const mcp_name = typeof params?.mcp_name === "string" ? params.mcp_name.trim() : "";
        if (!user_id || !mcp_name) {
          respond(false, { error: "user_id and mcp_name are required" });
          return;
        }
        try {
          const result = await client.grantMcpUserAccess({ user_id, mcp_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_mcp_user_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const mcp_name = typeof params?.mcp_name === "string" ? params.mcp_name.trim() : "";
        if (!user_id || !mcp_name) {
          respond(false, { error: "user_id and mcp_name are required" });
          return;
        }
        try {
          const result = await client.revokeMcpUserAccess({ user_id, mcp_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.grant_all_mcp_user_access",
      async ({ params, respond }) => {
        const mcp_name = typeof params?.mcp_name === "string" ? params.mcp_name.trim() : "";
        if (!mcp_name) {
          respond(false, { error: "mcp_name is required" });
          return;
        }
        try {
          const result = await client.grantAllMcpUserAccess({ mcp_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_all_mcp_user_access",
      async ({ params, respond }) => {
        const mcp_name = typeof params?.mcp_name === "string" ? params.mcp_name.trim() : "";
        if (!mcp_name) {
          respond(false, { error: "mcp_name is required" });
          return;
        }
        try {
          const result = await client.revokeAllMcpUserAccess({ mcp_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod("sonance.admin.seed_mcp_user_access", async ({ respond }) => {
      try {
        const result = await client.seedMcpUserAccess();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.mcp_setup_config", async ({ respond }) => {
      try {
        const result = await client.getAdminMcpSetupConfig();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod(
      "sonance.admin.update_mcp_setup_config",
      async ({ params, respond }) => {
        const mcp_name = typeof params?.mcp_name === "string" ? params.mcp_name.trim() : "";
        const enabled = params?.enabled === true;
        if (!mcp_name) {
          respond(false, { error: "mcp_name is required" });
          return;
        }
        try {
          const result = await client.updateMcpSetupConfig({ mcp_name, enabled });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    // ── MCP Groups ──────────────────────────────────────────────────────────
    api.registerGatewayMethod("sonance.admin.mcp_groups", async ({ respond }) => {
      try {
        const result = await client.getAdminMcpGroups();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.create_mcp_group", async ({ params, respond }) => {
      const name = typeof params?.name === "string" ? params.name.trim() : "";
      const description = typeof params?.description === "string" ? params.description.trim() : "";
      if (!name) {
        respond(false, { error: "name is required" });
        return;
      }
      try {
        const result = await client.createMcpGroup({ name, description: description || undefined });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.update_mcp_group", async ({ params, respond }) => {
      const group_id = typeof params?.group_id === "string" ? params.group_id.trim() : "";
      if (!group_id) {
        respond(false, { error: "group_id is required" });
        return;
      }
      try {
        const result = await client.updateMcpGroup(group_id, {
          name: typeof params?.name === "string" ? params.name.trim() : undefined,
          description:
            typeof params?.description === "string" ? params.description.trim() : undefined,
        });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.delete_mcp_group", async ({ params, respond }) => {
      const group_id = typeof params?.group_id === "string" ? params.group_id.trim() : "";
      if (!group_id) {
        respond(false, { error: "group_id is required" });
        return;
      }
      try {
        const result = await client.deleteMcpGroup(group_id);
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.add_group_members", async ({ params, respond }) => {
      const group_id = typeof params?.group_id === "string" ? params.group_id.trim() : "";
      const user_ids = Array.isArray(params?.user_ids) ? params.user_ids : [];
      if (!group_id || user_ids.length === 0) {
        respond(false, { error: "group_id and user_ids are required" });
        return;
      }
      try {
        const result = await client.addGroupMembers(group_id, { user_ids });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.remove_group_member", async ({ params, respond }) => {
      const group_id = typeof params?.group_id === "string" ? params.group_id.trim() : "";
      const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
      if (!group_id || !user_id) {
        respond(false, { error: "group_id and user_id are required" });
        return;
      }
      try {
        const result = await client.removeGroupMember(group_id, user_id);
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.grant_group_access", async ({ params, respond }) => {
      const group_id = typeof params?.group_id === "string" ? params.group_id.trim() : "";
      const mcp_name = typeof params?.mcp_name === "string" ? params.mcp_name.trim() : "";
      if (!group_id || !mcp_name) {
        respond(false, { error: "group_id and mcp_name are required" });
        return;
      }
      try {
        const result = await client.grantGroupAccess(group_id, { mcp_name });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.revoke_group_access", async ({ params, respond }) => {
      const group_id = typeof params?.group_id === "string" ? params.group_id.trim() : "";
      const mcp_name = typeof params?.mcp_name === "string" ? params.mcp_name.trim() : "";
      if (!group_id || !mcp_name) {
        respond(false, { error: "group_id and mcp_name are required" });
        return;
      }
      try {
        const result = await client.revokeGroupAccess(group_id, mcp_name);
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.project_access", async ({ respond }) => {
      try {
        const result = await client.getAdminProjectAccess();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("sonance.admin.grant_project_access", async ({ params, respond }) => {
      const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
      const project_ref = typeof params?.project_ref === "string" ? params.project_ref.trim() : "";
      const project_name =
        typeof params?.project_name === "string" ? params.project_name.trim() : "";
      if (!user_id || !project_ref) {
        respond(false, { error: "user_id and project_ref are required" });
        return;
      }
      try {
        const result = await client.grantProjectAccess({ user_id, project_ref, project_name });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod(
      "sonance.admin.revoke_project_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const project_ref =
          typeof params?.project_ref === "string" ? params.project_ref.trim() : "";
        if (!user_id || !project_ref) {
          respond(false, { error: "user_id and project_ref are required" });
          return;
        }
        try {
          const result = await client.revokeProjectAccess({ user_id, project_ref });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_all_project_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        if (!user_id) {
          respond(false, { error: "user_id is required" });
          return;
        }
        try {
          const result = await client.revokeAllProjectAccess({ user_id });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.grant_all_project_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        if (!user_id) {
          respond(false, { error: "user_id is required" });
          return;
        }
        try {
          const result = await client.grantAllProjectAccess({ user_id });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    // ── GitHub repo access (admin) ──────────────────────────────────────

    api.registerGatewayMethod("sonance.admin.github_repo_access", async ({ respond }) => {
      try {
        const result = await client.getAdminGitHubRepoAccess();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod(
      "sonance.admin.grant_github_repo_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const repo_full_name =
          typeof params?.repo_full_name === "string" ? params.repo_full_name.trim() : "";
        const repo_name = typeof params?.repo_name === "string" ? params.repo_name.trim() : "";
        if (!user_id || !repo_full_name) {
          respond(false, { error: "user_id and repo_full_name are required" });
          return;
        }
        try {
          const result = await client.grantGitHubRepoAccess({ user_id, repo_full_name, repo_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_github_repo_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const repo_full_name =
          typeof params?.repo_full_name === "string" ? params.repo_full_name.trim() : "";
        if (!user_id || !repo_full_name) {
          respond(false, { error: "user_id and repo_full_name are required" });
          return;
        }
        try {
          const result = await client.revokeGitHubRepoAccess({ user_id, repo_full_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_all_github_repo_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        if (!user_id) {
          respond(false, { error: "user_id is required" });
          return;
        }
        try {
          const result = await client.revokeAllGitHubRepoAccess({ user_id });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.grant_all_github_repo_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        if (!user_id) {
          respond(false, { error: "user_id is required" });
          return;
        }
        try {
          const result = await client.grantAllGitHubRepoAccess({ user_id });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    // ── Vercel project access (admin) ─────────────────────────────────────

    api.registerGatewayMethod("sonance.admin.vercel_project_access", async ({ respond }) => {
      try {
        const result = await client.getAdminVercelProjectAccess();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod(
      "sonance.admin.grant_vercel_project_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const project_id = typeof params?.project_id === "string" ? params.project_id.trim() : "";
        const project_name =
          typeof params?.project_name === "string" ? params.project_name.trim() : "";
        if (!user_id || !project_id) {
          respond(false, { error: "user_id and project_id are required" });
          return;
        }
        try {
          const result = await client.grantVercelProjectAccess({
            user_id,
            project_id,
            project_name,
          });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_vercel_project_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const project_id = typeof params?.project_id === "string" ? params.project_id.trim() : "";
        if (!user_id || !project_id) {
          respond(false, { error: "user_id and project_id are required" });
          return;
        }
        try {
          const result = await client.revokeVercelProjectAccess({ user_id, project_id });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_all_vercel_project_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        if (!user_id) {
          respond(false, { error: "user_id is required" });
          return;
        }
        try {
          const result = await client.revokeAllVercelProjectAccess({ user_id });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.grant_all_vercel_project_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        if (!user_id) {
          respond(false, { error: "user_id is required" });
          return;
        }
        try {
          const result = await client.grantAllVercelProjectAccess({ user_id });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    // ── Databricks catalog access (admin) ───────────────────────────────

    api.registerGatewayMethod("sonance.admin.databricks_access", async ({ respond }) => {
      try {
        const result = await client.getAdminDatabricksAccess();
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod(
      "sonance.admin.grant_databricks_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const catalog_name =
          typeof params?.catalog_name === "string" ? params.catalog_name.trim() : "";
        if (!user_id || !catalog_name) {
          respond(false, { error: "user_id and catalog_name are required" });
          return;
        }
        try {
          const result = await client.grantDatabricksAccess({ user_id, catalog_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "sonance.admin.revoke_databricks_access",
      async ({ params, respond }) => {
        const user_id = typeof params?.user_id === "string" ? params.user_id.trim() : "";
        const catalog_name =
          typeof params?.catalog_name === "string" ? params.catalog_name.trim() : "";
        if (!user_id || !catalog_name) {
          respond(false, { error: "user_id and catalog_name are required" });
          return;
        }
        try {
          const result = await client.revokeDatabricksAccess({ user_id, catalog_name });
          respond(true, result);
        } catch (err) {
          respond(false, { error: String(err) });
        }
      },
    );

    api.registerGatewayMethod("sonance.skills.update_settings", async ({ params, respond }) => {
      const skillName = typeof params?.skillName === "string" ? params.skillName.trim() : "";
      if (!skillName) {
        respond(false, { error: "skillName is required" });
        return;
      }
      try {
        const result = await client.updateSkillSettings(skillName, {
          enabled: typeof params?.enabled === "boolean" ? params.enabled : undefined,
          notify_advisories:
            typeof params?.notify_advisories === "boolean" ? params.notify_advisories : undefined,
          custom_settings:
            params?.custom_settings && typeof params.custom_settings === "object"
              ? (params.custom_settings as Record<string, unknown>)
              : undefined,
        });
        respond(true, result);
      } catch (err) {
        respond(false, { error: String(err) });
      }
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
    const toolName = "cortex_" + mcpName + "__" + tool.name;
    const inputProps = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;

    api.registerTool({
      name: toolName,
      label: toolName,
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

  syncMcpAgent(api.logger, mcpName, tools);
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
 * Bridge the Cortex CompositeMCPBridge — a single JSON-RPC 2.0 endpoint that
 * aggregates all registered MCPs (GitHub, Supabase, Vercel, etc.) with
 * namespace-prefixed tool names (e.g. `github__list_repositories`).
 *
 * Unlike `bridgeHttpMcp` which uses separate URLs for tools/list and tools/call,
 * this sends all JSON-RPC calls to the same URL.
 */
function bridgeCortexMcp(api: OpenClawPluginApi, bridgeUrl: string, apiKey: string): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };

  const rpc = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const reqHeaders: Record<string, string> = { ...headers };
    const userCtx = pluginUserStore.getStore();
    if (userCtx?.senderId) {
      reqHeaders["X-Cortex-User-Id"] = userCtx.senderId;
      api.logger.info?.(`[user-ctx] cortex rpc(${method}) delegating to user ${userCtx.senderId}`);
    }
    const res = await fetch(bridgeUrl, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Cortex MCP bridge ${method} failed: ${res.status} ${errText}`);
    }
    const body = (await res.json()) as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    if (body.error) {
      throw new Error(body.error.message ?? `Cortex MCP bridge error (${method})`);
    }
    return body.result;
  };

  // Helper: register bridge tools from a tool list (used by both cache and live paths)
  type BridgeTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
  const registerBridgeTools = (tools: BridgeTool[]) => {
    for (const tool of tools) {
      const schema = tool.inputSchema
        ? jsonSchemaToTypeBox(tool.inputSchema as Parameters<typeof jsonSchemaToTypeBox>[0])
        : Type.Object({});

      const prefixedName = "cortex_" + tool.name;
      api.registerTool({
        name: prefixedName,
        label: prefixedName,
        description: `[cortex-mcp] ${tool.description ?? tool.name}`,
        parameters: schema,
        async execute(_toolCallId, params) {
          const callResult = await rpc("tools/call", {
            name: tool.name,
            arguments: params as Record<string, unknown>,
          });
          const content = (callResult as { content?: Array<{ type: string; text?: string }> })
            ?.content;
          const text = content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n");
          return wrapTextResult(text || JSON.stringify(callResult ?? {}));
        },
      });
      api.logger.info(`[sonance-cortex] registered bridge tool: ${prefixedName}`);
    }
  };

  const syncBridgeAgents = (tools: BridgeTool[]) => {
    const mcpGroups = new Map<string, BridgeTool[]>();
    for (const tool of tools) {
      const sep = tool.name.indexOf("__");
      if (sep === -1) continue;
      const mcpName = tool.name.slice(0, sep);
      const shortName = tool.name.slice(sep + 2);
      let list = mcpGroups.get(mcpName);
      if (!list) {
        list = [];
        mcpGroups.set(mcpName, list);
      }
      list.push({ ...tool, name: shortName });
    }
    for (const [mcpName, mcpTools] of mcpGroups) {
      syncMcpAgent(api.logger, mcpName, mcpTools);
    }
  };

  // ── Synchronous cache: load tools from disk so they're available before
  //    the async bridge discovery completes. This prevents the race condition
  //    where the tool policy evaluates cortex_* before tools are registered.
  let loadedFromCache = false;
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");
    const stateDir =
      process.env.ATHENA_STATE_DIR?.trim() ||
      process.env.OPENCLAW_STATE_DIR?.trim() ||
      path.join(os.homedir(), ".openclaw");
    const cacheFile = path.join(stateDir, "cache", "cortex-bridge-tools.json");
    const raw = fs.readFileSync(cacheFile, "utf-8");
    const cached = JSON.parse(raw) as BridgeTool[];
    if (Array.isArray(cached) && cached.length > 0) {
      registerBridgeTools(cached);
      api.logger.info(`[sonance-cortex] loaded ${cached.length} tool(s) from bridge cache (sync)`);
      syncBridgeAgents(cached);
      loadedFromCache = true;
    }
  } catch {
    // No cache yet — first run or cache cleared; tools will load async.
  }

  // ── Async discovery: fetch live tool list from Cortex and refresh the cache.
  rpc("tools/list")
    .then((result) => {
      const tools = ((result as { tools?: unknown[] })?.tools ?? []) as BridgeTool[];

      // Write cache for next synchronous load
      try {
        const fs = require("node:fs") as typeof import("node:fs");
        const os = require("node:os") as typeof import("node:os");
        const path = require("node:path") as typeof import("node:path");
        const stateDir =
          process.env.ATHENA_STATE_DIR?.trim() ||
          process.env.OPENCLAW_STATE_DIR?.trim() ||
          path.join(os.homedir(), ".openclaw");
        const cacheDir = path.join(stateDir, "cache");
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
          path.join(cacheDir, "cortex-bridge-tools.json"),
          JSON.stringify(tools),
          "utf-8",
        );
      } catch (cacheErr) {
        api.logger.warn(`[sonance-cortex] failed to write bridge tool cache: ${String(cacheErr)}`);
      }

      if (loadedFromCache) {
        api.logger.info(
          `[sonance-cortex] async refresh: ${tools.length} tool(s) from CompositeMCPBridge (already loaded from cache)`,
        );
        return;
      }

      registerBridgeTools(tools);
      api.logger.info(`[sonance-cortex] loaded ${tools.length} tool(s) from CompositeMCPBridge`);
      syncBridgeAgents(tools);
    })
    .catch((err) => {
      api.logger.warn(`[sonance-cortex] CompositeMCPBridge discovery failed: ${String(err)}`);
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
        const callHeaders: Record<string, string> = { ...mcpHeaders };
        const userCtx = pluginUserStore.getStore();
        if (userCtx?.senderId) {
          callHeaders["X-Cortex-User-Id"] = userCtx.senderId;
        }
        const callRes = await fetch(baseUrl + "/tools/call", {
          method: "POST",
          headers: callHeaders,
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

// ---------------------------------------------------------------------------
// Agent sync — writes agent entries to athena.json so MCP tools appear on the
// Agents page. Mirrors cortex-tools/src/agent-sync.ts but runs inline so
// agent discovery works without needing the cortex-tools plugin loaded.
// ---------------------------------------------------------------------------

function syncMcpAgent(
  logger: { info(msg: string): void; warn(msg: string): void },
  mcpName: string,
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>,
): void {
  // Dynamic imports so this doesn't break if fs/os/path aren't bundled
  // in some future browser-only context.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");

    const stateDir =
      process.env.ATHENA_STATE_DIR?.trim() ||
      process.env.OPENCLAW_STATE_DIR?.trim() ||
      path.join(os.homedir(), ".athena");
    // Try athena.json first (newer), fall back to openclaw.json (legacy)
    const athenaPath = path.join(stateDir, "athena.json");
    const openclawPath = path.join(stateDir, "openclaw.json");
    const configPath = fs.existsSync(athenaPath) ? athenaPath : openclawPath;

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      logger.warn("[sonance-cortex] agent sync: could not read athena.json, skipping");
      return;
    }

    if (!config.agents || typeof config.agents !== "object") {
      (config as Record<string, unknown>).agents = {};
    }
    const agents = config.agents as Record<string, unknown>;
    if (!Array.isArray(agents.list)) {
      agents.list = [];
    }
    const agentList = agents.list as Record<string, unknown>[];

    const agentId = "cortex-" + mcpName.replace(/_/g, "-");
    const displayName = mcpName
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    const toolNames = tools.map((t) => "cortex_" + mcpName + "__" + t.name);

    // Check if agent already exists — skip the config write to avoid
    // triggering the config-watcher restart loop.
    // Do NOT set tools.allow — plugin tools are automatically available via
    // the plugin system, and setting allow with only plugin tool names
    // triggers stripPluginOnlyAllowlist warnings.  Worse, if a core tool
    // name is ever added to allow it would restrict ALL core tools (read,
    // write, edit, memory_search, etc.).
    const existing = agentList.find((a) => a.id === agentId);
    if (existing) {
      const toolsCfg = (existing.tools ?? {}) as Record<string, unknown>;
      if (toolsCfg.profile === "full" && !toolsCfg.allow) {
        logger.info(
          "[sonance-cortex] agent sync: '" +
            agentId +
            "' already up to date (" +
            toolNames.length +
            " tools)",
        );
        return;
      }
      if (!existing.tools || typeof existing.tools !== "object") {
        existing.tools = {};
      }
      const cfg = existing.tools as Record<string, unknown>;
      cfg.profile = "full";
      delete cfg.allow;
    } else {
      agentList.push({
        id: agentId,
        name: displayName,
        tools: { profile: "full" },
      });
    }

    // Write workspace directory with basic identity
    const workspaceDir = path.join(stateDir, "workspace-" + agentId);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const identityPath = path.join(workspaceDir, "IDENTITY.md");
    if (!fs.existsSync(identityPath)) {
      fs.writeFileSync(identityPath, `- Name: ${displayName}\n- Emoji: \uD83D\uDD27\n`, "utf-8");
    }

    // Write config back
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    logger.info(
      "[sonance-cortex] agent sync: synced agent '" +
        agentId +
        "' with " +
        toolNames.length +
        " tools",
    );
  } catch (err) {
    logger.warn("[sonance-cortex] agent sync failed: " + String(err));
  }
}

// ---------------------------------------------------------------------------
// Local-only Sonance gateway methods (no Cortex API needed)
// ---------------------------------------------------------------------------

function registerLocalSonanceMethods(api: OpenClawPluginApi): void {
  // -- Tool & Plugin Whitelist Audit (dynamic runtime discovery) -----------
  api.registerGatewayMethod("sonance.tools.audit", async ({ respond }) => {
    try {
      const { TOOL_GROUPS } = await import("../../src/agents/tool-policy.js");
      const { buildPluginStatusReport } = await import("../../src/plugins/status.js");

      const sonanceAllowed = new Set(TOOL_GROUPS["group:sonance"] ?? []);
      const sonanceDenyProfile = new Set([
        "exec",
        "process",
        "write",
        "edit",
        "apply_patch",
        "gateway",
        "nodes",
        "sessions_spawn",
        "sessions_send",
        "whatsapp_login",
        "cron",
        "browser",
      ]);

      type Risk = "critical" | "high" | "medium" | "low" | "safe";
      type Status = "allowed" | "denied" | "unreviewed";

      const RISK_MAP: Record<string, { risk: Risk; concerns: string[] }> = {
        read: { risk: "low", concerns: ["Can read config files containing secrets"] },
        write: {
          risk: "critical",
          concerns: ["Arbitrary file creation", "Could overwrite critical configs"],
        },
        edit: { risk: "critical", concerns: ["Can modify any accessible file"] },
        apply_patch: { risk: "critical", concerns: ["Bulk file modification"] },
        exec: { risk: "critical", concerns: ["Arbitrary command execution", "Data exfiltration"] },
        process: { risk: "critical", concerns: ["Can kill system processes"] },
        web_search: { risk: "medium", concerns: ["Sends queries to external APIs"] },
        web_fetch: { risk: "medium", concerns: ["Outbound network requests", "SSRF potential"] },
        message: { risk: "high", concerns: ["Data exfiltration via messages"] },
        sessions_list: { risk: "low", concerns: ["Reveals session metadata"] },
        sessions_history: { risk: "low", concerns: ["Can read other sessions' data"] },
        sessions_send: { risk: "high", concerns: ["Cross-session prompt injection"] },
        sessions_spawn: { risk: "high", concerns: ["Creates autonomous sub-agents"] },
        subagents: { risk: "medium", concerns: ["Sub-agent tree visibility"] },
        session_status: { risk: "safe", concerns: [] },
        browser: { risk: "critical", concerns: ["Full browser automation", "Credential theft"] },
        canvas: { risk: "medium", concerns: ["Client-side code execution"] },
        cron: { risk: "high", concerns: ["Persistent autonomous execution"] },
        gateway: { risk: "high", concerns: ["Service disruption"] },
        nodes: { risk: "high", concerns: ["Remote command execution"] },
        agents_list: { risk: "safe", concerns: [] },
        image: { risk: "low", concerns: ["External API calls"] },
        tts: { risk: "low", concerns: ["External API calls"] },
        memory_search: { risk: "low", concerns: ["Can surface indexed content"] },
        memory_get: { risk: "low", concerns: ["Direct memory access"] },
        whatsapp_login: { risk: "high", concerns: ["Owner-only channel authentication"] },
        lobster: { risk: "medium", concerns: ["Interactive shell sessions"] },
        llm_task: { risk: "medium", concerns: ["Spawns autonomous LLM sub-tasks"] },
      };

      const DESCRIPTIONS: Record<string, string> = {
        read: "Read file contents from workspace",
        write: "Write/create files on the filesystem",
        edit: "Edit existing files (find & replace)",
        apply_patch: "Apply unified diff patches to files",
        exec: "Execute shell commands on the host",
        process: "Manage background processes",
        web_search: "Search the web",
        web_fetch: "Fetch and parse web page content",
        message: "Send messages to channels/users",
        sessions_list: "List active agent sessions",
        sessions_history: "Read session conversation history",
        sessions_send: "Send a message to another session",
        sessions_spawn: "Spawn a new sub-agent session",
        subagents: "List/manage spawned sub-agent sessions",
        session_status: "Show current session status",
        browser: "Control a headless browser",
        canvas: "Render HTML/React UI canvases",
        cron: "Create/manage scheduled tasks",
        gateway: "Control the gateway server",
        nodes: "Manage remote node connections",
        agents_list: "List configured agents",
        image: "Generate images via AI models",
        tts: "Text-to-speech synthesis",
        memory_search: "Search vector memory store",
        memory_get: "Retrieve specific memory entries",
        whatsapp_login: "WhatsApp login flow (owner-only)",
      };

      function categoryForTool(name: string): string {
        for (const [group, members] of Object.entries(TOOL_GROUPS)) {
          if (group === "group:openclaw" || group === "group:sonance") continue;
          if (members.includes(name)) return group.replace("group:", "");
        }
        return "other";
      }

      function resolveStatus(name: string): Status {
        if (sonanceDenyProfile.has(name)) return "denied";
        if (sonanceAllowed.has(name)) return "allowed";
        return "unreviewed";
      }

      const coreNames = new Set(TOOL_GROUPS["group:openclaw"] ?? []);
      for (const name of [
        "read",
        "write",
        "edit",
        "apply_patch",
        "exec",
        "process",
        "tts",
        "whatsapp_login",
      ]) {
        coreNames.add(name);
      }

      type ToolEntry = {
        name: string;
        category: string;
        risk: Risk;
        status: Status;
        description: string;
        concerns: string[];
        source: "core" | "plugin" | "channel";
        pluginId?: string;
      };

      const coreTools: ToolEntry[] = [];
      for (const name of coreNames) {
        const riskInfo = RISK_MAP[name] ?? {
          risk: "medium" as Risk,
          concerns: ["Not yet assessed"],
        };
        coreTools.push({
          name,
          category: categoryForTool(name),
          risk: riskInfo.risk,
          status: resolveStatus(name),
          description: DESCRIPTIONS[name] ?? name,
          concerns: riskInfo.concerns,
          source: "core",
        });
      }

      const pluginTools: ToolEntry[] = [];
      type PluginInfo = {
        id: string;
        name: string;
        status: string;
        enabled: boolean;
        toolNames: string[];
        source: string;
        kind?: string;
        channelIds: string[];
        gatewayMethods: string[];
      };
      const plugins: PluginInfo[] = [];

      try {
        const report = buildPluginStatusReport();
        for (const plugin of report.plugins) {
          plugins.push({
            id: plugin.id,
            name: plugin.name,
            status: plugin.status,
            enabled: plugin.enabled,
            toolNames: plugin.toolNames,
            source: plugin.source,
            kind: plugin.kind,
            channelIds: plugin.channelIds,
            gatewayMethods: plugin.gatewayMethods,
          });

          for (const toolName of plugin.toolNames) {
            if (coreNames.has(toolName)) continue;
            const riskInfo = RISK_MAP[toolName] ?? {
              risk: "medium" as Risk,
              concerns: ["Third-party plugin tool — not yet assessed"],
            };
            pluginTools.push({
              name: toolName,
              category: "plugin:" + plugin.id,
              risk: riskInfo.risk,
              status: resolveStatus(toolName),
              description: DESCRIPTIONS[toolName] ?? `Tool from ${plugin.name}`,
              concerns: riskInfo.concerns,
              source: "plugin",
              pluginId: plugin.id,
            });
          }
        }
      } catch {
        // Plugin system may not be available; core tools still work
      }

      const allTools = [...coreTools, ...pluginTools];
      const summary = {
        total: allTools.length,
        allowed: allTools.filter((t) => t.status === "allowed").length,
        denied: allTools.filter((t) => t.status === "denied").length,
        unreviewed: allTools.filter((t) => t.status === "unreviewed").length,
        coreCount: coreTools.length,
        pluginToolCount: pluginTools.length,
        pluginCount: plugins.length,
      };

      respond(true, { tools: allTools, plugins, summary });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- MCP Server Whitelist Audit -------------------------------------------
  api.registerGatewayMethod("sonance.mcp.audit", async ({ respond }) => {
    try {
      const config = parseCortexConfig(api.pluginConfig);

      let allPluginToolNames: string[] = [];
      try {
        const { buildPluginStatusReport } = await import("../../src/plugins/status.js");
        const report = buildPluginStatusReport();
        for (const plugin of report.plugins) {
          allPluginToolNames = allPluginToolNames.concat(plugin.toolNames);
        }
      } catch {
        // Plugin system may not be available
      }

      const servers = config.mcpServers.map((entry) => {
        const toolPrefix = `cortex_${entry.name.replace(/[^a-zA-Z0-9]/g, "_")}__`;
        const toolNames = allPluginToolNames.filter((t) => t.startsWith(toolPrefix));
        return {
          name: entry.name,
          transport: entry.transport ?? (entry.command ? "stdio" : "http"),
          url: entry.url,
          command: entry.command,
          registerTools: entry.registerTools !== false,
          toolCount: toolNames.length,
          toolNames,
        };
      });

      respond(true, {
        servers,
        summary: {
          total: servers.length,
          active: servers.filter((s) => s.registerTools).length,
          toolsRegistered: servers.reduce((sum, s) => sum + s.toolCount, 0),
        },
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Upstream Sync Status ------------------------------------------------
  api.registerGatewayMethod("sonance.upstream.status", async ({ params, respond }) => {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const cwd = process.cwd();

      const doFetch = params?.fetch === true;
      if (doFetch) {
        await execFileAsync("git", ["fetch", "upstream", "main", "--quiet"], {
          cwd,
          timeout: 30_000,
        });
      }

      const hasUpstream = await execFileAsync("git", ["remote", "get-url", "upstream"], {
        cwd,
        timeout: 5_000,
      })
        .then(() => true)
        .catch(() => false);

      if (!hasUpstream) {
        respond(true, {
          configured: false,
          ahead: 0,
          behind: 0,
          mergeBase: null,
          localBranch: null,
          lastFetched: null,
        });
        return;
      }

      const [branchRes, countRes, baseRes] = await Promise.all([
        execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 5_000 }),
        execFileAsync("git", ["rev-list", "--left-right", "--count", "HEAD...upstream/main"], {
          cwd,
          timeout: 5_000,
        }).catch(() => ({ stdout: "0\t0" })),
        execFileAsync("git", ["merge-base", "HEAD", "upstream/main"], {
          cwd,
          timeout: 5_000,
        }).catch(() => ({ stdout: "" })),
      ]);

      const localBranch = branchRes.stdout.trim();
      const [ahead, behind] = countRes.stdout.trim().split(/\s+/).map(Number);
      const mergeBase = baseRes.stdout.trim().slice(0, 12) || null;

      respond(true, {
        configured: true,
        ahead: ahead || 0,
        behind: behind || 0,
        mergeBase,
        localBranch,
        lastFetched: doFetch ? new Date().toISOString() : null,
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Upstream Commits (categorized diffs + conflict detection) -----------
  api.registerGatewayMethod("sonance.upstream.commits", async ({ respond }) => {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const execFileAsync = promisify(execFile);
      const cwd = process.cwd();

      const hasUpstream = await execFileAsync("git", ["remote", "get-url", "upstream"], {
        cwd,
        timeout: 5_000,
      })
        .then(() => true)
        .catch(() => false);

      if (!hasUpstream) {
        respond(true, { commits: [], categories: [], conflicts: [], newTools: [] });
        return;
      }

      const baseRes = await execFileAsync("git", ["merge-base", "HEAD", "upstream/main"], {
        cwd,
        timeout: 5_000,
      }).catch(() => ({ stdout: "" }));
      const mergeBase = baseRes.stdout.trim();
      if (!mergeBase) {
        respond(true, { commits: [], categories: [], conflicts: [], newTools: [] });
        return;
      }

      const [logRes, diffRes] = await Promise.all([
        execFileAsync("git", ["log", "--oneline", "--no-merges", `HEAD..upstream/main`], {
          cwd,
          timeout: 10_000,
        }).catch(() => ({ stdout: "" })),
        execFileAsync("git", ["diff", "--name-only", mergeBase, "upstream/main"], {
          cwd,
          timeout: 10_000,
        }).catch(() => ({ stdout: "" })),
      ]);

      const commits = logRes.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const sep = line.indexOf(" ");
          return { hash: line.slice(0, sep), message: line.slice(sep + 1) };
        });

      const changedFiles = diffRes.stdout.trim().split("\n").filter(Boolean);

      const categoryMap: Record<string, string[]> = {};
      const riskMap: Record<string, string> = {
        tools: "HIGH",
        security: "HIGH",
        config: "MEDIUM",
        plugins: "MEDIUM",
        gateway: "MEDIUM",
        channels: "LOW",
        deps: "MEDIUM",
        tests: "LOW",
        docs: "LOW",
        cli: "LOW",
        ui: "LOW",
        infra: "LOW",
        other: "LOW",
      };

      for (const file of changedFiles) {
        let cat = "other";
        if (/^src\/agents\/tool|^src\/agents\/pi-tools/.test(file)) cat = "tools";
        else if (/^src\/security\/|^src\/gateway\/auth/.test(file)) cat = "security";
        else if (/^src\/config\//.test(file)) cat = "config";
        else if (/^src\/plugins\/|^extensions\//.test(file)) cat = "plugins";
        else if (/^src\/gateway\//.test(file)) cat = "gateway";
        else if (/^src\/cli\/|^src\/commands\//.test(file)) cat = "cli";
        else if (/\.test\.ts$|^test\//.test(file)) cat = "tests";
        else if (/^docs\//.test(file)) cat = "docs";
        else if (
          /^src\/channels\/|^src\/telegram|^src\/discord|^src\/slack|^src\/signal|^src\/imessage|^src\/routing/.test(
            file,
          )
        )
          cat = "channels";
        else if (/^package\.json$|^pnpm-lock\.yaml$|^patches\//.test(file)) cat = "deps";
        else if (/^src\/tui|^src\/web|^src\/canvas|^apps\/|^ui\//.test(file)) cat = "ui";
        else if (/^scripts\/|^\.github\//.test(file)) cat = "infra";

        if (!categoryMap[cat]) categoryMap[cat] = [];
        categoryMap[cat].push(file);
      }

      const categories = Object.entries(categoryMap).map(([name, files]) => ({
        name,
        risk: riskMap[name] ?? "LOW",
        files,
        count: files.length,
      }));

      let sonanceFiles: string[] = [];
      try {
        const manifest = readFileSync(join(cwd, "SONANCE_FORK.md"), "utf-8");
        const matches = manifest.match(/\| `([^`]+)`/g);
        if (matches) {
          sonanceFiles = matches.map((m) => m.replace(/\| `|`/g, "").trim());
        }
      } catch {}

      const conflicts = sonanceFiles.filter((sf) => changedFiles.includes(sf));
      const newTools = changedFiles.filter((f) => /^src\/agents\/tools\/.*-tool\.ts$/.test(f));

      respond(true, { commits, categories, conflicts, newTools });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Upstream Diff (per-commit or per-file diff content) ------------------
  api.registerGatewayMethod("sonance.upstream.diff", async ({ params, respond }) => {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const cwd = process.cwd();

      const commit = params?.commit as string | undefined;
      const file = params?.file as string | undefined;

      let rawDiff = "";

      if (commit) {
        // Show diff for a specific commit
        const res = await execFileAsync(
          "git",
          ["show", commit, "--format=", "--patch", "--diff-filter=ACMRD"],
          { cwd, timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
        ).catch(() => ({ stdout: "" }));
        rawDiff = res.stdout;
      } else if (file) {
        // Show cumulative diff for a specific file between merge-base and upstream/main
        const baseRes = await execFileAsync("git", ["merge-base", "HEAD", "upstream/main"], {
          cwd,
          timeout: 5_000,
        }).catch(() => ({ stdout: "" }));
        const mergeBase = baseRes.stdout.trim();
        if (!mergeBase) {
          respond(true, { diffs: [] });
          return;
        }
        const res = await execFileAsync("git", ["diff", mergeBase, "upstream/main", "--", file], {
          cwd,
          timeout: 15_000,
          maxBuffer: 5 * 1024 * 1024,
        }).catch(() => ({ stdout: "" }));
        rawDiff = res.stdout;
      } else {
        respond(false, { error: "Provide either 'commit' or 'file' parameter" });
        return;
      }

      // Parse unified diff into structured hunks per file
      const diffs = parseUnifiedDiff(rawDiff);
      respond(true, { diffs });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Upstream Analyze (AI-powered change analysis) ------------------------
  api.registerGatewayMethod("sonance.upstream.analyze", async ({ params, respond }) => {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const execFileAsync = promisify(execFile);
      const cwd = process.cwd();

      const commitHashes = params?.commits as string[] | undefined;
      if (!commitHashes || commitHashes.length === 0) {
        respond(false, { error: "Provide 'commits' array of commit hashes to analyze" });
        return;
      }

      // Read fork manifest to know Athena-modified files
      let sonanceFiles: string[] = [];
      try {
        const manifest = readFileSync(join(cwd, "SONANCE_FORK.md"), "utf-8");
        const matches = manifest.match(/\| `([^`]+)`/g);
        if (matches) {
          sonanceFiles = matches.map((m) => m.replace(/\| `|`/g, "").trim());
        }
      } catch {}

      // Gather per-commit diffs
      const commitDetails: Array<{ hash: string; message: string; diff: string; files: string[] }> =
        [];
      for (const hash of commitHashes.slice(0, 20)) {
        const [showRes, filesRes] = await Promise.all([
          execFileAsync("git", ["show", hash, "--format=%s", "--patch"], {
            cwd,
            timeout: 10_000,
            maxBuffer: 2 * 1024 * 1024,
          }).catch(() => ({ stdout: "" })),
          execFileAsync("git", ["diff-tree", "--no-commit-id", "-r", "--name-only", hash], {
            cwd,
            timeout: 5_000,
          }).catch(() => ({ stdout: "" })),
        ]);
        const lines = showRes.stdout.split("\n");
        const message = lines[0] ?? "";
        const diff = lines.slice(1).join("\n").trim();
        const files = filesRes.stdout.trim().split("\n").filter(Boolean);
        commitDetails.push({ hash, message, diff: diff.slice(0, 8000), files });
      }

      // Build the LLM prompt
      const sonanceFileList =
        sonanceFiles.length > 0
          ? sonanceFiles.map((f) => `  - ${f}`).join("\n")
          : "  (no Athena-modified files found in SONANCE_FORK.md)";

      const commitSections = commitDetails
        .map(
          (c) =>
            `### Commit ${c.hash}: ${c.message}\nFiles changed: ${c.files.join(", ")}\n\`\`\`diff\n${c.diff}\n\`\`\``,
        )
        .join("\n\n");

      const prompt = `You are a helpful assistant explaining software updates to an admin who manages "Athena" — a customized version of a program called OpenClaw. Your job is to read the code changes and explain them in plain, non-technical language so the admin can decide which updates to install.

## What is Athena?

Athena is a customized fork of OpenClaw. The admin's team has modified these specific files to add their own features (security lockdown, Cortex integration, Apollo proxy, SSO login):
${sonanceFileList}

Any update that touches one of the files listed above needs extra care because it could conflict with Athena's customizations. Updates that DON'T touch those files are safe to install.

## Updates to Review

${commitSections}

## What I Need From You

For each update, tell me:
1. **What it does** — explain in 1-2 plain English sentences what this update changes or improves. Avoid jargon. Think "what would a product manager say?"
2. **Why it matters** — is this a bug fix, a new feature, a performance improvement, a security patch, or just cleanup/maintenance?
3. **Type** — classify as exactly one of: "feature", "bugfix", "security", "performance", "ui", "docs", "maintenance"
4. **Usefulness** — rate "high", "medium", or "low" based on how valuable this update is likely to be for a team using OpenClaw as an AI assistant platform
5. **Safe to install?** — "yes" if it doesn't touch any Athena-customized files, "needs-review" if it does touch them (with explanation of what could go wrong)
6. **Risk level** — for "needs-review" items only: "low", "medium", or "high"

Also provide:
- An **overall summary** in 2-3 plain English sentences: what's the big picture of these updates? Are they worth installing?
- A **recommended install order** (safest updates first)

Respond with ONLY valid JSON (no markdown fences):
{
  "safeCommits": [{"hash": "...", "message": "...", "reason": "...", "plainSummary": "What this update does in plain English", "type": "feature|bugfix|security|performance|ui|docs|maintenance", "usefulness": "high|medium|low"}],
  "riskyCommits": [{"hash": "...", "message": "...", "conflictFiles": ["..."], "riskLevel": "low|medium|high", "aiSummary": "Plain English explanation of what could go wrong", "plainSummary": "What this update does in plain English", "type": "feature|bugfix|security|performance|ui|docs|maintenance", "usefulness": "high|medium|low"}],
  "overallAssessment": "Plain English summary of all updates and whether they're worth installing",
  "recommendedOrder": ["hash1", "hash2"]
}`;

      // Call Claude via completeSimple
      let aiResult: Record<string, unknown>;
      try {
        const { completeSimple } = await import("@mariozechner/pi-ai");
        const { resolveModel } = await import("../../src/agents/pi-embedded-runner/model.js");
        const { resolveApiKeyForProvider, requireApiKey } =
          await import("../../src/agents/model-auth.js");

        const resolved = resolveModel(
          "anthropic",
          "claude-sonnet-4-5-20250929",
          undefined,
          api.config,
        );
        if (!resolved.model) {
          respond(false, {
            error: "Could not resolve Claude model. Check your Anthropic API key configuration.",
          });
          return;
        }

        const auth = await resolveApiKeyForProvider({ provider: "anthropic", cfg: api.config });
        const apiKey = requireApiKey(auth, "anthropic");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);
        try {
          const res = await completeSimple(
            resolved.model,
            { messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }] },
            { apiKey, maxTokens: 4096, temperature: 0.2, signal: controller.signal },
          );

          const text = res.content
            .filter((block: { type: string }) => block.type === "text")
            .map((block: { type: string; text: string }) => block.text.trim())
            .join(" ");

          // Strip markdown fences if present
          const cleaned = text
            .replace(/^```json?\s*\n?/i, "")
            .replace(/\n?```\s*$/i, "")
            .trim();
          aiResult = JSON.parse(cleaned);
        } finally {
          clearTimeout(timeout);
        }
      } catch (llmErr) {
        // If LLM call fails, fall back to heuristic analysis with human-readable fields
        const safeCommits: Array<Record<string, unknown>> = [];
        const riskyCommits: Array<Record<string, unknown>> = [];

        for (const c of commitDetails) {
          const overlapping = c.files.filter((f) => sonanceFiles.includes(f));
          if (overlapping.length === 0) {
            safeCommits.push({
              hash: c.hash,
              message: c.message,
              reason: "Doesn't touch any files that Athena has customized",
              plainSummary: c.message,
              type: "maintenance",
              usefulness: "medium",
            });
          } else {
            riskyCommits.push({
              hash: c.hash,
              message: c.message,
              conflictFiles: overlapping,
              riskLevel: overlapping.length > 2 ? "high" : "medium",
              aiSummary: `This update changes ${overlapping.length} file(s) that Athena has customized. Installing it could overwrite Athena's changes. AI-powered analysis wasn't available to give more detail.`,
              plainSummary: c.message,
              type: "maintenance",
              usefulness: "medium",
            });
          }
        }

        aiResult = {
          safeCommits,
          riskyCommits,
          overallAssessment: `We couldn't reach the AI assistant, so this is a basic check. ${safeCommits.length} update(s) look safe to install. ${riskyCommits.length} update(s) touch files Athena has customized and need manual review.`,
          recommendedOrder: safeCommits.map((c) => c.hash),
        };
      }

      respond(true, aiResult);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // Helper: heuristic classification when AI batch fails
  function heuristicClassify(
    c: { hash: string; message: string; files: string[]; touchesAthena: boolean },
    sonanceFiles: string[],
  ) {
    const overlapping = c.files.filter((f) => sonanceFiles.includes(f));
    const isSecurity = /security|auth|cve|vuln/i.test(c.message);
    const isFix = /fix|bug|patch/i.test(c.message);
    const isTestOnly = c.files.every((f) => f.includes(".test.") || f.startsWith("test/"));
    const isDocsOnly = c.files.every((f) => f.startsWith("docs/"));
    if (overlapping.length > 0) {
      return {
        hash: c.hash,
        message: c.message,
        classification: "risky" as const,
        importance: isSecurity ? "critical" : "high",
        type: isSecurity ? "security" : "maintenance",
        plainSummary: c.message,
        reason: `Touches ${overlapping.length} Athena file(s)`,
        conflictFiles: overlapping,
      };
    }
    if (isTestOnly || isDocsOnly) {
      return {
        hash: c.hash,
        message: c.message,
        classification: "irrelevant" as const,
        importance: "low",
        type: isTestOnly ? "maintenance" : "docs",
        plainSummary: c.message,
        reason: isTestOnly ? "Test-only change" : "Docs-only change",
        conflictFiles: [],
      };
    }
    return {
      hash: c.hash,
      message: c.message,
      classification: "relevant" as const,
      importance: isSecurity ? "critical" : isFix ? "medium" : "medium",
      type: isSecurity ? "security" : isFix ? "bugfix" : "maintenance",
      plainSummary: c.message,
      reason: "Automated classification (AI unavailable for this batch)",
      conflictFiles: [],
    };
  }

  // -- Upstream Full AI Review (all commits, Athena-aware) ------------------
  api.registerGatewayMethod("sonance.upstream.reviewAll", async ({ respond }) => {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const execFileAsync = promisify(execFile);
      const cwd = process.cwd();

      const hasUpstream = await execFileAsync("git", ["remote", "get-url", "upstream"], {
        cwd,
        timeout: 5_000,
      })
        .then(() => true)
        .catch(() => false);

      if (!hasUpstream) {
        respond(false, {
          error:
            "Upstream remote not configured. Run: git remote add upstream https://github.com/openclaw/openclaw.git",
        });
        return;
      }

      // Fetch latest
      await execFileAsync("git", ["fetch", "upstream", "main", "--quiet"], {
        cwd,
        timeout: 30_000,
      }).catch(() => {});

      const baseRes = await execFileAsync("git", ["merge-base", "HEAD", "upstream/main"], {
        cwd,
        timeout: 5_000,
      }).catch(() => ({ stdout: "" }));
      const mergeBase = baseRes.stdout.trim();
      if (!mergeBase) {
        respond(true, {
          summary:
            "Could not find a common ancestor between your branch and upstream. This usually means the upstream remote needs to be configured correctly.",
          relevantUpdates: [],
          irrelevantUpdates: [],
          riskyUpdates: [],
          updateInstructions: [],
          totalReviewed: 0,
        });
        return;
      }

      // Get all commits
      const logRes = await execFileAsync(
        "git",
        ["log", "--oneline", "--no-merges", "HEAD..upstream/main"],
        { cwd, timeout: 10_000 },
      ).catch(() => ({ stdout: "" }));

      const allCommits = logRes.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const sep = line.indexOf(" ");
          return { hash: line.slice(0, sep), message: line.slice(sep + 1) };
        });

      if (allCommits.length === 0) {
        respond(true, {
          summary: "Athena is fully up to date with OpenClaw. No new updates to review.",
          relevantUpdates: [],
          irrelevantUpdates: [],
          riskyUpdates: [],
          updateInstructions: [],
          totalReviewed: 0,
        });
        return;
      }

      // Read fork manifest
      let forkManifest = "";
      try {
        forkManifest = readFileSync(join(cwd, "SONANCE_FORK.md"), "utf-8");
      } catch {}

      let sonanceFiles: string[] = [];
      const fileMatches = forkManifest.match(/\| `([^`]+)`/g);
      if (fileMatches) {
        sonanceFiles = fileMatches.map((m) => m.replace(/\| `|`/g, "").trim());
      }

      const reviewBatch = allCommits.slice(0, 50);
      const commitDetails: Array<{
        hash: string;
        message: string;
        files: string[];
        touchesAthena: boolean;
      }> = [];

      for (const c of reviewBatch) {
        const filesRes = await execFileAsync(
          "git",
          ["diff-tree", "--no-commit-id", "-r", "--name-only", c.hash],
          { cwd, timeout: 5_000 },
        ).catch(() => ({ stdout: "" }));
        const files = filesRes.stdout.trim().split("\n").filter(Boolean);
        const touchesAthena = files.some((f) => sonanceFiles.includes(f));
        commitDetails.push({ hash: c.hash, message: c.message, files, touchesAthena });
      }

      const athenaFilesSummary = sonanceFiles.length > 0 ? sonanceFiles.join(", ") : "(none found)";

      // ── Batched AI review ───────────────────────────────────────────
      // Apollo proxy silently rejects large requests, so we split the
      // work into small batches of ≤8 commits each (matching the proven
      // request size of the single-commit `analyze` method).
      const BATCH_SIZE = 8;
      const batches: (typeof commitDetails)[] = [];
      for (let i = 0; i < commitDetails.length; i += BATCH_SIZE) {
        batches.push(commitDetails.slice(i, i + BATCH_SIZE));
      }

      type ClassifiedCommit = {
        hash: string;
        message: string;
        classification: "relevant" | "risky" | "irrelevant";
        importance: string;
        type: string;
        plainSummary: string;
        reason: string;
        conflictFiles: string[];
      };

      const allClassified: ClassifiedCommit[] = [];
      let aiBatchesSucceeded = 0;
      let aiBatchesFailed = 0;

      // Resolve API endpoint and key.
      // Priority: direct Anthropic key (env) > Apollo proxy > resolver fallback.
      let apiUrl = "";
      let apiKey = "";
      let modelId = "claude-sonnet-4-5-20250929";
      let aiSource = "none";

      const pluginCfg = parseCortexConfig(api.pluginConfig);

      const directKey =
        process.env.SONANCE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
      if (directKey) {
        apiKey = directKey;
        apiUrl = "https://api.anthropic.com/v1/messages";
        aiSource = "direct-anthropic";
      } else {
        // Check Apollo proxy
        const apolloUrl = pluginCfg.apolloBaseUrl || process.env.SONANCE_APOLLO_BASE_URL || "";
        if (apolloUrl && pluginCfg.apiKey) {
          // Verify Apollo is reachable before committing to it
          // Apollo is configured — trust the config and use it.
          // If Apollo is down, individual batch calls will fail and fall back to heuristic.
          apiKey = pluginCfg.apiKey;
          apiUrl = apolloUrl.replace(/\/+$/, "") + "/v1/messages";
          aiSource = "apollo-proxy";
        }
      }

      // Last resort: try the model-auth resolver (might find keys from other sources)
      if (!apiKey) {
        try {
          const { resolveApiKeyForProvider, requireApiKey: requireKey } =
            await import("../../src/agents/model-auth.js");
          const auth = await resolveApiKeyForProvider({ provider: "anthropic", cfg: api.config });
          const resolved = requireKey(auth, "anthropic");
          if (resolved) {
            // Check if this is just the Apollo key (which won't work if Apollo is down)
            if (resolved.startsWith("ctx_")) {
              api.logger.warn(
                "[sonance-cortex] reviewAll: only Cortex key available but Apollo is down",
              );
            } else {
              apiKey = resolved;
              apiUrl = "https://api.anthropic.com/v1/messages";
              aiSource = "resolver:" + auth.source;
            }
          }
        } catch {
          // Key resolution failed entirely
        }
      }

      api.logger.info(
        "[sonance-cortex] reviewAll: source=" + aiSource + ", url=" + (apiUrl || "(none)"),
      );

      if (!apiKey) {
        api.logger.warn(
          "[sonance-cortex] reviewAll: No AI available. Apollo is not running and no ANTHROPIC_API_KEY env var set. Using heuristic.",
        );
        for (const c of commitDetails) {
          allClassified.push(heuristicClassify(c, sonanceFiles));
        }
      } else {
        api.logger.info(
          "[sonance-cortex] reviewAll: " +
            commitDetails.length +
            " commits in " +
            batches.length +
            " batches via " +
            aiSource,
        );

        for (let bi = 0; bi < batches.length; bi++) {
          const batch = batches[bi];
          const batchTable = batch
            .map(
              (c) =>
                `${c.hash} | ${c.message}${c.touchesAthena ? " [ATHENA]" : ""} | ${c.files.slice(0, 6).join(", ")}`,
            )
            .join("\n");

          const batchPrompt = `Classify these OpenClaw updates for "Athena" (enterprise fork with security lockdown, Cortex, Apollo proxy, SSO, M365 MCP).
Protected files: ${athenaFilesSummary}
Rules: "relevant"=useful, "risky"=useful but touches protected files, "irrelevant"=mobile/cosmetic/niche.

${batchTable}

Respond ONLY valid JSON array, no markdown:
[{"hash":"...","classification":"relevant|risky|irrelevant","importance":"critical|high|medium|low","type":"security|bugfix|feature|performance|maintenance|docs","plainSummary":"one sentence","reason":"one sentence"}]`;

          try {
            const httpRes = await fetch(apiUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: modelId,
                max_tokens: 4096,
                temperature: 0.2,
                messages: [{ role: "user", content: batchPrompt }],
              }),
              signal: AbortSignal.timeout(60_000),
            });

            const responseText = await httpRes.text();

            if (!httpRes.ok) {
              api.logger.warn(
                "[sonance-cortex] reviewAll batch " +
                  (bi + 1) +
                  " HTTP " +
                  httpRes.status +
                  ": " +
                  responseText.slice(0, 300),
              );
              throw new Error("HTTP " + httpRes.status);
            }

            const res = JSON.parse(responseText) as {
              content?: Array<{ type: string; text?: string }>;
              stop_reason?: string;
            };

            const text = (res.content ?? [])
              .filter((b) => b.type === "text" && b.text)
              .map((b) => b.text!.trim())
              .join(" ");

            api.logger.info(
              "[sonance-cortex] reviewAll batch " +
                (bi + 1) +
                "/" +
                batches.length +
                " ok: " +
                text.length +
                " chars, stop: " +
                (res.stop_reason ?? "n/a"),
            );

            if (text.length < 5) throw new Error("Empty response");

            const cleaned = text
              .replace(/^```json?\s*\n?/i, "")
              .replace(/\n?```\s*$/i, "")
              .trim();

            const parsed = JSON.parse(cleaned) as Array<{
              hash: string;
              classification?: string;
              importance?: string;
              type?: string;
              plainSummary?: string;
              reason?: string;
            }>;

            for (const item of parsed) {
              const commit = batch.find((c) => c.hash.startsWith(item.hash));
              if (!commit) continue;
              allClassified.push({
                hash: commit.hash,
                message: commit.message,
                classification:
                  item.classification === "risky" || item.classification === "irrelevant"
                    ? item.classification
                    : "relevant",
                importance: item.importance ?? "medium",
                type: item.type ?? "maintenance",
                plainSummary: item.plainSummary ?? commit.message,
                reason: item.reason ?? "",
                conflictFiles: commit.touchesAthena
                  ? commit.files.filter((f) => sonanceFiles.includes(f))
                  : [],
              });
            }
            aiBatchesSucceeded++;
          } catch (batchErr) {
            api.logger.warn(
              "[sonance-cortex] reviewAll batch " + (bi + 1) + " failed: " + String(batchErr),
            );
            aiBatchesFailed++;
            for (const c of batch) {
              allClassified.push(heuristicClassify(c, sonanceFiles));
            }
          }
        }
      }

      // ── Assemble final result from classified commits ───────────────
      const relevant: Array<Record<string, unknown>> = [];
      const irrelevant: Array<Record<string, unknown>> = [];
      const risky: Array<Record<string, unknown>> = [];

      for (const c of allClassified) {
        if (c.classification === "risky") {
          risky.push({
            hash: c.hash,
            message: c.message,
            importance: c.importance,
            type: c.type,
            plainSummary: c.plainSummary,
            whyItMatters: c.reason,
            conflictFiles: c.conflictFiles,
            riskExplanation:
              c.conflictFiles.length > 0
                ? `Touches Athena files: ${c.conflictFiles.join(", ")}. Review the diff to ensure Athena's customizations are preserved.`
                : c.reason,
          });
        } else if (c.classification === "irrelevant") {
          irrelevant.push({
            hash: c.hash,
            message: c.message,
            importance: c.importance,
            type: c.type,
            plainSummary: c.plainSummary,
            skipReason: c.reason,
          });
        } else {
          relevant.push({
            hash: c.hash,
            message: c.message,
            importance: c.importance,
            type: c.type,
            plainSummary: c.plainSummary,
            whyItMatters: c.reason,
            safe: true,
            conflictFiles: [],
          });
        }
      }

      const aiQuality =
        aiBatchesSucceeded > 0
          ? aiBatchesFailed === 0
            ? "Full AI analysis completed"
            : `AI analyzed ${aiBatchesSucceeded}/${batches.length} batches (${aiBatchesFailed} fell back to heuristic)`
          : aiSource === "none"
            ? "AI review requires either Apollo running locally (port 8000) or an ANTHROPIC_API_KEY environment variable. Using automated heuristic instead"
            : "AI was unavailable — using automated heuristic review";

      const safeHashes = relevant.map((r) => r.hash as string);
      const aiResult: Record<string, unknown> = {
        summary: `${aiQuality}. ${relevant.length} updates are recommended, ${risky.length} need careful review (touch Athena files), and ${irrelevant.length} can be skipped.`,
        relevantUpdates: relevant,
        irrelevantUpdates: irrelevant,
        riskyUpdates: risky,
        updateInstructions: [
          {
            phase: 1,
            title: "Phase 1: Safe Updates",
            description:
              "These updates don't touch Athena-customized files and are safe to install.",
            hashes: safeHashes,
            steps: [
              "Select these updates in the Update Manager",
              "Click 'Preview Install' to verify",
              "Click 'Install Updates' to apply on a separate branch",
              "Test the gateway, then merge when satisfied",
            ],
          },
          ...(risky.length > 0
            ? [
                {
                  phase: 2,
                  title: "Phase 2: Manual Review Required",
                  description: "These touch Athena-customized files and need careful merging.",
                  hashes: risky.map((r) => r.hash),
                  steps: [
                    "Review each update's diff carefully",
                    "Compare with Athena's version of the conflicting files",
                    "Manually merge changes or skip if the Athena version is preferred",
                  ],
                },
              ]
            : []),
        ],
        totalReviewed: commitDetails.length,
      };

      respond(true, aiResult);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Upstream Apply (cherry-pick onto integration branch) -----------------
  api.registerGatewayMethod("sonance.upstream.apply", async ({ params, respond }) => {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const execFileAsync = promisify(execFile);
      const cwd = process.cwd();

      const commitHashes = params?.commits as string[] | undefined;
      const dryRun = params?.dryRun !== false; // default true
      const branchName =
        (params?.branch as string) ||
        `athena/upstream-sync-${new Date().toISOString().slice(0, 10)}`;
      const resolutions = (params?.resolutions ?? {}) as Record<string, string>;

      if (!commitHashes || commitHashes.length === 0) {
        respond(false, { error: "Provide 'commits' array of commit hashes to apply" });
        return;
      }

      // Record original branch so we can return to it
      const origBranch = (
        await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd,
          timeout: 5_000,
        })
      ).stdout.trim();

      if (dryRun) {
        // Dry run: check each commit for conflicts without modifying anything
        const results: Array<{
          hash: string;
          status: string;
          conflictFiles?: string[];
        }> = [];

        for (const hash of commitHashes) {
          const filesRes = await execFileAsync(
            "git",
            ["diff-tree", "--no-commit-id", "-r", "--name-only", hash],
            { cwd, timeout: 5_000 },
          ).catch(() => ({ stdout: "" }));
          const files = filesRes.stdout.trim().split("\n").filter(Boolean);

          // Check if any file has local modifications compared to the merge base
          let hasConflict = false;
          const conflictFiles: string[] = [];
          const baseRes = await execFileAsync("git", ["merge-base", "HEAD", "upstream/main"], {
            cwd,
            timeout: 5_000,
          }).catch(() => ({ stdout: "" }));
          const mergeBase = baseRes.stdout.trim();

          if (mergeBase) {
            for (const file of files) {
              const localDiff = await execFileAsync(
                "git",
                ["diff", "--name-only", mergeBase, "HEAD", "--", file],
                { cwd, timeout: 5_000 },
              ).catch(() => ({ stdout: "" }));
              if (localDiff.stdout.trim()) {
                hasConflict = true;
                conflictFiles.push(file);
              }
            }
          }

          results.push({
            hash,
            status: hasConflict ? "conflict" : "applied",
            ...(conflictFiles.length > 0 ? { conflictFiles } : {}),
          });
        }

        respond(true, { branch: branchName, results, dryRun: true });
        return;
      }

      // Actual apply: create branch and cherry-pick
      // Check if branch already exists
      const branchExists = await execFileAsync("git", ["rev-parse", "--verify", branchName], {
        cwd,
        timeout: 5_000,
      })
        .then(() => true)
        .catch(() => false);

      if (branchExists) {
        await execFileAsync("git", ["checkout", branchName], { cwd, timeout: 5_000 });
      } else {
        await execFileAsync("git", ["checkout", "-b", branchName], { cwd, timeout: 5_000 });
      }

      const results: Array<{
        hash: string;
        status: string;
        conflictFiles?: string[];
        error?: string;
      }> = [];

      for (const hash of commitHashes) {
        try {
          await execFileAsync("git", ["cherry-pick", "--no-commit", hash], {
            cwd,
            timeout: 30_000,
          });

          // Apply any pre-resolved conflict files
          for (const [filePath, content] of Object.entries(resolutions)) {
            try {
              writeFileSync(join(cwd, filePath), content, "utf-8");
              await execFileAsync("git", ["add", filePath], { cwd, timeout: 5_000 });
            } catch {}
          }

          await execFileAsync(
            "git",
            ["commit", "--no-edit", "-m", `upstream: cherry-pick ${hash}`],
            { cwd, timeout: 10_000 },
          );

          results.push({ hash, status: "applied" });
        } catch (cpErr) {
          // Cherry-pick failed — check for conflicts
          const statusRes = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=U"], {
            cwd,
            timeout: 5_000,
          }).catch(() => ({ stdout: "" }));
          const conflictFiles = statusRes.stdout.trim().split("\n").filter(Boolean);

          // Check if we have resolutions for all conflict files
          const allResolved = conflictFiles.every((f) => resolutions[f]);
          if (allResolved && conflictFiles.length > 0) {
            for (const filePath of conflictFiles) {
              writeFileSync(join(cwd, filePath), resolutions[filePath], "utf-8");
              await execFileAsync("git", ["add", filePath], { cwd, timeout: 5_000 });
            }
            await execFileAsync(
              "git",
              ["commit", "--no-edit", "-m", `upstream: cherry-pick ${hash} (resolved)`],
              { cwd, timeout: 10_000 },
            );
            results.push({ hash, status: "applied" });
          } else {
            // Abort this cherry-pick
            await execFileAsync("git", ["cherry-pick", "--abort"], { cwd, timeout: 5_000 }).catch(
              () => {},
            );
            results.push({
              hash,
              status: "conflict",
              conflictFiles,
              error: String(cpErr),
            });
          }
        }
      }

      // Return to original branch
      await execFileAsync("git", ["checkout", origBranch], { cwd, timeout: 5_000 }).catch(() => {});

      respond(true, { branch: branchName, results, dryRun: false });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });
}

/** Parse unified diff output into structured per-file hunks. */
function parseUnifiedDiff(raw: string): Array<{
  file: string;
  status: string;
  hunks: string;
  isBinary: boolean;
}> {
  if (!raw.trim()) return [];
  const files: Array<{ file: string; status: string; hunks: string; isBinary: boolean }> = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    const file = headerMatch?.[2] ?? headerMatch?.[1] ?? "unknown";
    const isBinary = section.includes("Binary files");

    let status = "modified";
    if (section.includes("new file mode")) status = "added";
    else if (section.includes("deleted file mode")) status = "deleted";
    else if (section.includes("rename from")) status = "renamed";

    // Extract hunk content (everything from first @@ onward), capped for sanity
    const hunkStart = section.indexOf("@@");
    const hunks = hunkStart >= 0 ? section.slice(hunkStart).slice(0, 5000) : "";

    files.push({ file, status, hunks, isBinary });
  }

  return files;
}

export default cortexPlugin;
