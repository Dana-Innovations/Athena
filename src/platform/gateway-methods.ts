/**
 * Athena Platform — Gateway method registration.
 *
 * Registers `athena.platform.*` methods on the gateway WebSocket API
 * so the control UI can query conversations, memory, metrics, and audit data.
 *
 * Called from the sonance-cortex plugin's registerLocalSonanceMethods().
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { createAthenaDatabase, type AthenaDatabase } from "./database/index.js";
import { persistAudit } from "./persistence.js";
import { loadAgentRegistry } from "./registry.js";

type GatewayApi = {
  registerGatewayMethod(
    name: string,
    handler: (ctx: {
      params?: Record<string, unknown> | null;
      respond: (ok: boolean, data: unknown) => void;
    }) => void | Promise<void>,
  ): void;
};

let db: AthenaDatabase | null = null;
function getDb(): AthenaDatabase {
  if (!db) {
    db = createAthenaDatabase();
    Promise.resolve(db.initSchema()).catch((err) =>
      console.error("[platform] initSchema failed:", err),
    );
  }
  return db;
}

function resolveRepoRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return process.cwd();
}

export function registerPlatformMethods(api: GatewayApi): void {
  // -- Agent Definitions --------------------------------------------------

  api.registerGatewayMethod("athena.platform.agents", ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const root = resolveRepoRoot();
      const registry = loadAgentRegistry(root);
      const agents = registry.agents.map((entry) => {
        const def = entry.definition;
        return {
          id: def.metadata.name,
          displayName: def.metadata.displayName,
          description: def.metadata.description ?? "",
          avatar: def.metadata.avatar ?? null,
          aliases: def.metadata.aliases ?? [],
          team: def.metadata.team ?? null,
          owner: def.metadata.owner ?? null,
          role: def.spec.role ?? "specialist",
          model: def.spec.runtime.model,
          compaction: def.spec.runtime.compaction ?? null,
          gateways: def.spec.gateways ?? {},
          skills: def.spec.skills ?? {},
          subagents: def.spec.subagents ?? null,
          cron: def.spec.cron ?? [],
          access: def.spec.access ?? {},
          collaboration: def.spec.collaboration ?? {},
          routing: def.spec.routing ?? {},
          soulContent: entry.soulContent,
          soulPath: entry.soulPath,
          definitionPath: entry.definitionPath,
        };
      });
      respond(true, { agents, errors: registry.errors });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.agent.soul.update", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const agentId = str(params?.agentId);
      const content = typeof params?.content === "string" ? params.content : null;
      if (!agentId || content === null) {
        respond(false, { error: "agentId and content are required" });
        return;
      }

      // Content guard: size limit
      if (content.length > 500_000) {
        respond(false, { error: "SOUL.md content exceeds 500KB limit." });
        return;
      }

      // Content guard: prompt injection patterns
      const INJECTION_PATTERNS = [
        /ignore\s+(all\s+)?(previous|above|prior)\s+instructions/i,
        /\byou\s+are\s+now\b/i,
        /disregard\s+(your|all|previous|above)\s+/i,
        /\bact\s+as\s+(a\s+)?different\b/i,
      ];
      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(content)) {
          respond(false, {
            error:
              `SOUL.md contains a potentially unsafe instruction pattern (matched: ${pattern.source}). ` +
              `Please rephrase to use positive, constructive instructions.`,
          });
          return;
        }
      }
      const root = resolveRepoRoot();
      const soulPath = resolve(root, "agents", "definitions", agentId, "SOUL.md");
      if (!existsSync(dirname(soulPath))) {
        respond(false, { error: `Agent directory not found for "${agentId}"` });
        return;
      }
      // Save to DB version history (best-effort — don't fail the save if DB fails)
      try {
        await getDb().saveSoulVersion({ agentId, content, createdBy: str(params?.userId) });
      } catch {
        // Versioning failure is non-fatal; proceed with the file write
      }
      writeFileSync(soulPath, content, "utf-8");
      // Also sync to workspace so the running agent picks it up
      const stateDir =
        process.env.ATHENA_STATE_DIR?.trim() ||
        process.env.OPENCLAW_STATE_DIR?.trim() ||
        join(homedir(), ".openclaw");
      const workspaceSoul = join(stateDir, `workspace-${agentId}`, "SOUL.md");
      if (existsSync(dirname(workspaceSoul))) {
        mkdirSync(dirname(workspaceSoul), { recursive: true });
        writeFileSync(workspaceSoul, content, "utf-8");
      }
      persistAudit({
        eventType: "agent_config_change",
        agentId,
        action: "soul_update",
        details: { contentLength: content.length },
      });
      respond(true, { ok: true });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.agent.soul.versions", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const agentId = str(params?.agentId);
      if (!agentId) {
        respond(false, { error: "agentId is required" });
        return;
      }
      const versions = await getDb().listSoulVersions(agentId);
      respond(true, { agentId, versions });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.agent.soul.rollback", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const agentId = str(params?.agentId);
      const version = typeof params?.version === "number" ? params.version : null;
      if (!agentId || version === null) {
        respond(false, { error: "agentId and version are required" });
        return;
      }
      const soulVersion = await getDb().getSoulVersion(agentId, version);
      if (!soulVersion) {
        respond(false, { error: `Version ${version} not found for agent "${agentId}"` });
        return;
      }
      const restored = soulVersion.content;
      // Sync restored content to the repo file and workspace
      const root = resolveRepoRoot();
      const soulPath = resolve(root, "agents", "definitions", agentId, "SOUL.md");
      if (existsSync(dirname(soulPath))) {
        writeFileSync(soulPath, restored, "utf-8");
      }
      const stateDir =
        process.env.ATHENA_STATE_DIR?.trim() ||
        process.env.OPENCLAW_STATE_DIR?.trim() ||
        join(homedir(), ".openclaw");
      const workspaceSoul = join(stateDir, `workspace-${agentId}`, "SOUL.md");
      if (existsSync(dirname(workspaceSoul))) {
        mkdirSync(dirname(workspaceSoul), { recursive: true });
        writeFileSync(workspaceSoul, restored, "utf-8");
      }
      persistAudit({
        eventType: "agent_config_change",
        agentId,
        action: "soul_rollback",
        details: { version },
      });
      respond(true, { ok: true, content: restored });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.agent.config.update", ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const agentId = str(params?.agentId);
      if (!agentId) {
        respond(false, { error: "agentId is required" });
        return;
      }
      const root = resolveRepoRoot();
      const yamlPath = resolve(root, "agents", "definitions", agentId, "agent.yaml");
      if (!existsSync(yamlPath)) {
        respond(false, { error: `Agent definition not found for "${agentId}"` });
        return;
      }
      const raw = readFileSync(yamlPath, "utf-8");
      const doc = YAML.parseDocument(raw);

      if (typeof params?.role === "string") {
        doc.setIn(["spec", "role"], params.role);
      }
      if (params?.model && typeof params.model === "object") {
        const model = params.model as Record<string, unknown>;
        if (typeof model.primary === "string") {
          doc.setIn(["spec", "runtime", "model", "primary"], model.primary);
        }
        if (typeof model.fallback === "string") {
          doc.setIn(["spec", "runtime", "model", "fallback"], model.fallback);
        }
      }
      if (Array.isArray(params?.allowAgents)) {
        doc.setIn(["spec", "subagents", "allowAgents"], params.allowAgents);
      }

      writeFileSync(yamlPath, doc.toString(), "utf-8");
      persistAudit({
        eventType: "agent_config_change",
        agentId,
        action: "config_update",
        details: {
          role: typeof params?.role === "string" ? params.role : undefined,
          model: params?.model ?? undefined,
          allowAgents: Array.isArray(params?.allowAgents) ? params.allowAgents : undefined,
        },
      });
      respond(true, { ok: true });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Stats / Overview ---------------------------------------------------

  api.registerGatewayMethod("athena.platform.stats", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const stats = await getDb().getPlatformStats();
      respond(true, stats);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.table_stats", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const stats = await getDb().getTableStats();
      respond(true, stats);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.agent_stats", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const agentId = typeof params?.agentId === "string" ? params.agentId : undefined;
      const stats = await getDb().getAgentStats(agentId);
      respond(true, { agents: stats });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Conversations ------------------------------------------------------

  api.registerGatewayMethod("athena.platform.conversations", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const conversations = await getDb().listConversations({
        agentId: str(params?.agentId),
        userId: str(params?.userId),
        gateway: str(params?.gateway),
        since: str(params?.since),
        until: str(params?.until),
        limit: num(params?.limit, 50),
        offset: num(params?.offset, 0),
      });
      respond(true, { conversations });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.conversation", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const id = str(params?.id);
      if (!id) {
        respond(false, { error: "id is required" });
        return;
      }
      const conversation = await getDb().getConversation(id);
      if (!conversation) {
        respond(false, { error: "Not found" });
        return;
      }
      respond(true, conversation);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Messages -----------------------------------------------------------

  api.registerGatewayMethod("athena.platform.messages", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const conversationId = str(params?.conversationId);
      if (!conversationId) {
        respond(false, { error: "conversationId is required" });
        return;
      }
      const messages = await getDb().getMessages({
        conversationId,
        role: str(params?.role),
        limit: num(params?.limit, 200),
        offset: num(params?.offset, 0),
      });
      respond(true, { messages });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.messages.search", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const query = str(params?.query);
      if (!query) {
        respond(false, { error: "query is required" });
        return;
      }
      const messages = await getDb().searchMessages(query, {
        agentId: str(params?.agentId),
        limit: num(params?.limit, 50),
        offset: num(params?.offset, 0),
      });
      respond(true, { messages });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Memory -------------------------------------------------------------

  api.registerGatewayMethod("athena.platform.memory", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const entries = await getDb().getMemory({
        agentId: str(params?.agentId),
        userId: str(params?.userId),
        category: str(params?.category),
        search: str(params?.search),
        limit: num(params?.limit, 100),
        offset: num(params?.offset, 0),
      });
      respond(true, { entries });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.memory.delete", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const id = str(params?.id);
      if (!id) {
        respond(false, { error: "id is required" });
        return;
      }
      await getDb().deleteMemory(id);
      respond(true, { ok: true });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Metrics ------------------------------------------------------------

  api.registerGatewayMethod("athena.platform.metrics", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const metrics = await getDb().getMetrics({
        agentId: str(params?.agentId),
        since: str(params?.since),
        until: str(params?.until),
      });
      respond(true, { metrics });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Audit --------------------------------------------------------------

  api.registerGatewayMethod("athena.platform.audit", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const events = await getDb().getAuditEvents({
        agentId: str(params?.agentId),
        userId: str(params?.userId),
        eventType: str(params?.eventType),
        since: str(params?.since),
        until: str(params?.until),
        limit: num(params?.limit, 100),
        offset: num(params?.offset, 0),
      });
      respond(true, { events });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Error Events -------------------------------------------------------

  api.registerGatewayMethod("athena.platform.agent.error_events", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const events = await getDb().getErrorEvents({
        agentId: str(params?.agentId),
        conversationId: str(params?.conversationId),
        since: str(params?.since),
        until: str(params?.until),
        limit: num(params?.limit, 100),
        offset: num(params?.offset, 0),
      });
      respond(true, { events });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Health / Latency ---------------------------------------------------

  api.registerGatewayMethod("athena.platform.agent.health", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const samples = await getDb().getHealthSamples({
        agentId: str(params?.agentId),
        status: params?.status as "success" | "error" | "timeout" | undefined,
        since: str(params?.since),
        until: str(params?.until),
        limit: num(params?.limit, 100),
        offset: num(params?.offset, 0),
      });
      respond(true, { samples });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Per-agent session reset --------------------------------------------

  api.registerGatewayMethod("athena.platform.agent.reset", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    const agentId = str(params?.agentId);
    if (!agentId) {
      respond(false, { error: "agentId is required." });
      return;
    }
    try {
      const { getAgentMessageBus } = await import("./message-bus.js");
      const bus = getAgentMessageBus();

      // Unsubscribe and re-subscribe to reset the agent's handler state.
      // This clears any in-memory accumulated context without restarting the process.
      const wasRegistered = bus.isRegistered(agentId);
      if (wasRegistered) {
        bus.unsubscribe(agentId);
      }

      persistAudit({
        eventType: "system",
        agentId,
        action: "agent_reset",
        details: { wasRegistered },
      });

      respond(true, {
        ok: true,
        agentId,
        wasRegistered,
        message: wasRegistered
          ? `Agent "${agentId}" has been unsubscribed from the bus. It will re-register on next startup or message.`
          : `Agent "${agentId}" was not registered — no action taken.`,
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Restart / Redeploy -------------------------------------------------

  api.registerGatewayMethod("athena.platform.restart", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    const mode = (process.env.ATHENA_MODE ?? "LOCAL").toUpperCase();
    if (mode !== "AZURE") {
      respond(true, {
        ok: true,
        mode: "local",
        message:
          "Running in LOCAL mode — container restart is only available when ATHENA_MODE=AZURE.",
      });
      return;
    }

    const appName = process.env.BOT_NAME?.trim() || "sonance-athena-bot-2026";
    const resourceGroup = process.env.BOT_RESOURCE_GROUP?.trim() || "Athena";

    try {
      // Get the latest active revision name
      const revisionName = await new Promise<string>((res, rej) => {
        execFile(
          "az",
          [
            "containerapp",
            "revision",
            "list",
            "--name",
            appName,
            "--resource-group",
            resourceGroup,
            "--query",
            "[?properties.active].name | [0]",
            "--output",
            "tsv",
          ],
          { timeout: 30_000 },
          (err, stdout, stderr) => {
            if (err) {
              rej(new Error(stderr || err.message));
            } else {
              res(stdout.trim());
            }
          },
        );
      });

      if (!revisionName) {
        respond(false, { error: "No active revision found for container app." });
        return;
      }

      // Restart the revision
      await new Promise<void>((res, rej) => {
        execFile(
          "az",
          [
            "containerapp",
            "revision",
            "restart",
            "--name",
            appName,
            "--resource-group",
            resourceGroup,
            "--revision",
            revisionName,
          ],
          { timeout: 60_000 },
          (err, _stdout, stderr) => {
            if (err) {
              rej(new Error(stderr || err.message));
            } else {
              res();
            }
          },
        );
      });

      persistAudit({
        eventType: "system",
        agentId: undefined,
        action: "gateway_restart",
        details: { appName, resourceGroup, revisionName },
      });

      respond(true, { ok: true, mode: "azure", appName, revisionName });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Cron ---------------------------------------------------------------

  api.registerGatewayMethod("athena.platform.cron", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const database = getDb();
      const jobs = await database.listCronJobs(str(params?.agentId));
      const runLimit = num(params?.limit, 5);
      // Fetch recent runs for each job (jobs with any prior runs)
      const runsByJob = await Promise.all(
        jobs.map(async (job) => {
          try {
            const runs = await database.getCronRuns(job.id, runLimit);
            return runs.map((r) => ({ ...r, agentId: job.agentId }));
          } catch {
            return [];
          }
        }),
      );
      const runs = runsByJob.flat();
      respond(true, { jobs, runs });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.cron_jobs", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const jobs = await getDb().listCronJobs(str(params?.agentId));
      respond(true, { jobs });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.cron_runs", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const jobId = str(params?.jobId);
      if (!jobId) {
        respond(false, { error: "jobId is required" });
        return;
      }
      const runs = await getDb().getCronRuns(jobId, num(params?.limit, 20));
      respond(true, { runs });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // -- Roundtable -----------------------------------------------------------

  api.registerGatewayMethod("athena.platform.roundtable", async ({ params, respond }) => {
    if (!requireAuth(params, respond)) {
      return;
    }
    try {
      const agentIds = params?.agentIds;
      const message = str(params?.message);
      const userId = str(params?.userId) ?? "gateway";

      if (!Array.isArray(agentIds) || agentIds.length < 2) {
        respond(false, { error: "agentIds must be an array of at least 2 agent IDs." });
        return;
      }
      if (!message) {
        respond(false, { error: "message is required." });
        return;
      }

      const { coordinateRoundtable } = await import("./roundtable.js");
      const result = await coordinateRoundtable(agentIds.map(String), message, userId, "gateway");
      respond(true, result);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });
}

// -- Helpers ----------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Auth gate for athena.platform.* methods.
 *
 * If ATHENA_PLATFORM_TOKEN is set, all platform method callers must supply
 * a matching `_token` param. If the env var is unset (local dev), all
 * calls are allowed (the WebSocket transport auth is sufficient).
 *
 * Returns true if authorized, false if rejected (respond() already called).
 */
function requireAuth(
  params: Record<string, unknown> | null | undefined,
  respond: (ok: boolean, data: unknown) => void,
): boolean {
  const platformToken = process.env.ATHENA_PLATFORM_TOKEN?.trim();
  if (!platformToken) {
    return true; // No token configured — allow (dev mode / transport-level auth)
  }
  const provided = typeof params?._token === "string" ? params._token.trim() : "";
  if (!provided || provided !== platformToken) {
    respond(false, {
      error: "Unauthorized — platform token required for athena.platform.* methods.",
    });
    return false;
  }
  return true;
}
