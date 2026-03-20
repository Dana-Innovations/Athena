/**
 * OpenClaw Runtime Adapter
 *
 * Reads agent definitions from agents/definitions/ and maps them into
 * OpenClaw config fragments that get merged during config resolution.
 *
 * This is the bridge between the portable agent schema (agent.yaml)
 * and the OpenClaw runtime configuration. If the runtime changes,
 * only this adapter needs to be rewritten.
 *
 * File storage goes through the FileStorageProvider abstraction so that
 * workspace files can live on local disk (dev) or Azure Blob (prod).
 * OpenClaw's runtime still expects a local workspace path, so the adapter
 * always maintains a local cache directory and syncs content through the
 * provider for durability.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { subscribeAgentToBus } from "./agent-bus-tool.js";
import { createAthenaDatabase } from "./database/index.js";
import { getAgentMessageBus } from "./message-bus.js";
import { resolveStorageProvider, type FileStorageProvider } from "./persistence/index.js";
import { writeSoulVersioned } from "./persistence/soul-versioning.js";
import { getProactiveSender } from "./proactive-sender.js";
import { loadAgentRegistry, type RegistryEntry } from "./registry.js";
import { getAgentRuntime } from "./runtime.js";

export type AgentConfigFragment = {
  id: string;
  default?: boolean;
  name: string;
  workspace: string;
  model: { primary: string; fallback?: string };
  tools?: {
    alsoAllow?: string[];
    deny?: string[];
  };
  subagents?: {
    allowAgents?: string[];
  };
};

export type PlatformConfigOverlay = {
  agents: {
    list: AgentConfigFragment[];
    defaults?: {
      model?: { primary: string; fallback?: string };
      compaction?: { mode: string };
      workspace?: string;
      subagents?: {
        maxSpawnDepth?: number;
        maxChildrenPerAgent?: number;
      };
    };
  };
  tools?: { alsoAllow?: string[] };
};

/**
 * Resolve the repo root by walking up from this file's directory
 * until we find package.json.
 */
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

/**
 * Sync the SOUL.md from the agent definition into:
 *   1. The local workspace directory (OpenClaw reads from here at runtime)
 *   2. The storage provider (durability — survives container restarts)
 */
function syncSoulToWorkspace(
  entry: RegistryEntry,
  workspaceDir: string,
  storage: FileStorageProvider,
): void {
  if (!entry.soulContent) {
    return;
  }

  mkdirSync(workspaceDir, { recursive: true });
  const targetPath = join(workspaceDir, "SOUL.md");

  if (existsSync(targetPath)) {
    const existing = readFileSync(targetPath, "utf-8");
    if (existing === entry.soulContent) {
      return;
    }
  }

  writeFileSync(targetPath, entry.soulContent);

  const agentId = entry.definition.metadata.name;
  writeSoulVersioned(storage, agentId, entry.soulContent).catch((err) =>
    console.warn(`[platform] durable write failed: ${agentId}/soul/SOUL.md — ${err}`),
  );
}

/**
 * Ensure the memory.md exists in the workspace (for onboarding marker).
 * Also persists to the storage provider for durability.
 */
function ensureMemoryFile(
  agentId: string,
  workspaceDir: string,
  storage: FileStorageProvider,
): void {
  const memPath = join(workspaceDir, "memory.md");
  if (!existsSync(memPath)) {
    mkdirSync(workspaceDir, { recursive: true });
    const content = "ONBOARDING_NEEDED\n";
    writeFileSync(memPath, content);
    storage
      .write(agentId, "workspace/memory.md", content)
      .catch((err) =>
        console.warn(`[platform] durable write failed: ${agentId}/workspace/memory.md — ${err}`),
      );
  }
}

/**
 * Map an agent definition to an OpenClaw agent list entry.
 */
function mapAgentToConfig(
  entry: RegistryEntry,
  stateDir: string,
  isDefault: boolean,
  storage: FileStorageProvider,
): AgentConfigFragment {
  const def = entry.definition;
  const workspaceDir = resolve(stateDir, `workspace-${def.metadata.name}`);

  syncSoulToWorkspace(entry, workspaceDir, storage);
  ensureMemoryFile(def.metadata.name, workspaceDir, storage);

  const toolsAllow = def.spec.skills?.cortex?.tools?.allow;
  const toolsDeny = def.spec.skills?.cortex?.tools?.deny;
  const allowAgents = def.spec.subagents?.allowAgents;

  return {
    id: def.metadata.name,
    ...(isDefault ? { default: true } : {}),
    name: def.metadata.displayName,
    workspace: workspaceDir,
    model: {
      primary: def.spec.runtime.model.primary,
      ...(def.spec.runtime.model.fallback ? { fallback: def.spec.runtime.model.fallback } : {}),
    },
    tools: {
      // Specialists get the restricted "sonance" profile so the LLM only sees
      // the tools it needs (via alsoAllow). Orchestrators keep "full" so they
      // retain access to exec, write, browser, etc.
      ...(def.spec.role === "specialist" ? { profile: "sonance" } : {}),
      ...(toolsAllow ? { alsoAllow: toolsAllow } : {}),
      ...(toolsDeny ? { deny: toolsDeny } : {}),
    },
    ...(allowAgents && allowAgents.length > 0 ? { subagents: { allowAgents } } : {}),
  };
}

type OverlayCache = {
  stateDir: string;
  overlay: PlatformConfigOverlay;
  /** mtime fingerprint of all source files (agent.yaml + SOUL.md) */
  mtimeKey: string;
};

let overlayCache: OverlayCache | null = null;

/**
 * Seed v1 SOUL.md for any agent that has no saved versions yet.
 * Fire-and-forget — called once when the overlay is first built.
 */
async function seedSoulVersions(entries: RegistryEntry[]): Promise<void> {
  const dbInstance = createAthenaDatabase();
  for (const entry of entries) {
    if (!entry.soulContent) {
      continue;
    }
    const agentId = entry.definition.metadata.name;
    try {
      const versions = await Promise.resolve(dbInstance.listSoulVersions(agentId));
      if (versions.length === 0) {
        await Promise.resolve(
          dbInstance.saveSoulVersion({ agentId, content: entry.soulContent, createdBy: "system" }),
        );
        console.log(`[platform] seeded SOUL.md v1 for agent: ${agentId}`);
      }
    } catch (err) {
      console.warn(
        `[platform] failed to seed soul version for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Build a fingerprint from mtimes of all agent definition source files.
 * If any file changes, the fingerprint changes and the cache is invalidated.
 */
function buildMtimeKey(repoRoot: string): string {
  const defsDir = join(repoRoot, "agents", "definitions");
  if (!existsSync(defsDir)) {
    return "";
  }
  const parts: string[] = [];
  try {
    for (const entry of readdirSync(defsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const agentDir = join(defsDir, entry.name);
      for (const file of ["agent.yaml", "SOUL.md"]) {
        const fp = join(agentDir, file);
        if (existsSync(fp)) {
          parts.push(`${fp}:${statSync(fp).mtimeMs}`);
        }
      }
    }
  } catch {
    return "";
  }
  return parts.join("|");
}

/**
 * Re-read SOUL.md for each agent and sync to workspace + storage provider.
 * Called on every config load so edits are picked up without restart.
 */
function syncAllSouls(
  repoRoot: string,
  _stateDir: string,
  overlay: PlatformConfigOverlay,
  storage: FileStorageProvider,
): void {
  const defsDir = join(repoRoot, "agents", "definitions");
  for (const agent of overlay.agents.list) {
    const soulPath = join(defsDir, agent.id, "SOUL.md");
    if (existsSync(soulPath)) {
      const content = readFileSync(soulPath, "utf-8");
      const targetPath = join(agent.workspace, "SOUL.md");
      mkdirSync(agent.workspace, { recursive: true });
      if (!existsSync(targetPath) || readFileSync(targetPath, "utf-8") !== content) {
        writeFileSync(targetPath, content);
        writeSoulVersioned(storage, agent.id, content).catch((err) =>
          console.warn(`[platform] durable write failed: ${agent.id}/soul/SOUL.md — ${err}`),
        );
      }
    }
  }
}

/**
 * Load platform agent definitions and produce an OpenClaw config overlay.
 *
 * Called from applySonanceDefaults during config resolution. Returns null
 * if no agent definitions exist (graceful fallback to manual config).
 * Config overlay is cached; SOUL.md files are re-synced on every call
 * so edits are picked up without restarting the gateway.
 */
export function loadPlatformAgentOverlay(stateDir: string): PlatformConfigOverlay | null {
  const repoRoot = resolveRepoRoot();
  const mtimeKey = buildMtimeKey(repoRoot);
  const storage = resolveStorageProvider(stateDir);

  // Cache hit: overlay structure unchanged, but still re-sync SOUL.md
  if (overlayCache && overlayCache.stateDir === stateDir && overlayCache.mtimeKey === mtimeKey) {
    syncAllSouls(repoRoot, stateDir, overlayCache.overlay, storage);
    return overlayCache.overlay;
  }

  const registry = loadAgentRegistry(repoRoot);

  if (registry.agents.length === 0) {
    return null;
  }

  // Seed v1 SOUL.md for any agent that has no saved versions yet.
  seedSoulVersions(registry.agents).catch((err) =>
    console.warn(`[platform] soul version seeding failed: ${err}`),
  );

  for (const err of registry.errors) {
    console.warn(`[platform] agent validation error in ${err.agentDir}:`);
    for (const issue of err.issues) {
      console.warn(`  ${issue.path}: ${issue.message}`);
    }
  }

  // Orchestrators are user-facing (get default: true); specialists are internal-only.
  // If no agent has role: "orchestrator", fall back to the first agent.
  const orchestratorIdx = registry.agents.findIndex(
    (e) => e.definition.spec.role === "orchestrator",
  );
  const defaultIdx = orchestratorIdx >= 0 ? orchestratorIdx : 0;

  const agentConfigs = registry.agents.map((entry, idx) =>
    mapAgentToConfig(entry, stateDir, idx === defaultIdx, storage),
  );

  const primaryAgent = agentConfigs[defaultIdx];
  const compactionMode = registry.agents[defaultIdx]?.definition.spec.runtime.compaction?.mode;

  // Resolve subagent spawn depth from the orchestrator's config
  const orchestratorDef = registry.agents[defaultIdx]?.definition;
  const maxSpawnDepth = orchestratorDef?.spec.subagents?.maxSpawnDepth ?? 2;
  const maxChildren = orchestratorDef?.spec.subagents?.maxConcurrent ?? 5;

  const allToolAllows = registry.agents.flatMap(
    (e) => e.definition.spec.skills?.cortex?.tools?.allow ?? [],
  );
  const uniqueToolAllows = [...new Set(allToolAllows)];

  // Configure inter-agent communication ACLs and subscribe agents to the bus.
  // The handler receives inter-agent queries and returns the agent's SOUL context
  // plus the question — the calling agent's LLM incorporates the response.
  const bus = getAgentMessageBus();
  for (const entry of registry.agents) {
    const agentId = entry.definition.metadata.name;
    const canContact = entry.definition.spec.collaboration?.canContact ?? [];
    bus.setAcl(agentId, canContact);

    if (!bus.isRegistered(agentId)) {
      const soulContent = entry.soulContent ?? "";
      const model = entry.definition.spec.runtime.model.primary;
      const displayName = entry.definition.metadata.displayName;
      subscribeAgentToBus(agentId, async (msgType, question, userId) => {
        const runtime = getAgentRuntime();
        const result = await runtime.run(
          agentId,
          [
            { role: "system", content: soulContent },
            { role: "user", content: question },
          ],
          { userId, model },
        );

        // For delegate (fire-and-forget) messages, deliver the result proactively
        // to the user rather than returning it to the caller (who isn't waiting).
        if (msgType === "delegate" && userId && result.text) {
          getProactiveSender()
            .sendToUser(userId, result.text, displayName)
            .catch((err) =>
              console.warn(`[platform] proactive send failed for ${agentId} → ${userId}: ${err}`),
            );
        }

        return result.text;
      });
    }
  }

  console.log(`[platform] message bus agents: [${getAgentMessageBus().listAgents().join(", ")}]`);

  // Include inter-agent tools in the allowlist so agents with collaboration
  // config can use query, delegate, and notify patterns.
  uniqueToolAllows.push("ask_agent", "delegate_to_agent", "notify_agent");

  const result: PlatformConfigOverlay = {
    agents: {
      list: agentConfigs,
      defaults: {
        model: primaryAgent.model,
        ...(compactionMode ? { compaction: { mode: compactionMode } } : {}),
        workspace: primaryAgent.workspace,
        subagents: {
          maxSpawnDepth,
          maxChildrenPerAgent: maxChildren,
        },
      },
    },
    ...(uniqueToolAllows.length > 0 ? { tools: { alsoAllow: uniqueToolAllows } } : {}),
  };

  overlayCache = { stateDir, overlay: result, mtimeKey };
  return result;
}
