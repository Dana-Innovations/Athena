/**
 * Athena Platform — Gateway method registration.
 *
 * Registers `athena.platform.*` methods on the gateway WebSocket API
 * so the control UI can query conversations, memory, metrics, and audit data.
 *
 * Called from the sonance-cortex plugin's registerLocalSonanceMethods().
 */
import { createAthenaDatabase, type AthenaDatabase } from "./database/index.js";

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
    void db.initSchema();
  }
  return db;
}

export function registerPlatformMethods(api: GatewayApi): void {
  // -- Stats / Overview ---------------------------------------------------

  api.registerGatewayMethod("athena.platform.stats", async ({ respond }) => {
    try {
      const stats = await getDb().getPlatformStats();
      respond(true, stats);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.table_stats", async ({ respond }) => {
    try {
      const stats = await getDb().getTableStats();
      respond(true, stats);
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.agent_stats", async ({ params, respond }) => {
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

  // -- Cron ---------------------------------------------------------------

  api.registerGatewayMethod("athena.platform.cron_jobs", async ({ params, respond }) => {
    try {
      const jobs = await getDb().listCronJobs(str(params?.agentId));
      respond(true, { jobs });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod("athena.platform.cron_runs", async ({ params, respond }) => {
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
}

// -- Helpers ----------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
