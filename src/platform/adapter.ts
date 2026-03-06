/**
 * OpenClaw Runtime Adapter
 *
 * Reads agent definitions from agents/definitions/ and maps them into
 * OpenClaw config fragments that get merged during config resolution.
 *
 * This is the bridge between the portable agent schema (agent.yaml)
 * and the OpenClaw runtime configuration. If the runtime changes,
 * only this adapter needs to be rewritten.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { getAgentMessageBus } from "./message-bus.js";
import { loadAgentRegistry, type RegistryEntry } from "./registry.js";

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
 * Ensure the SOUL.md from the agent definition is synced into the
 * workspace directory where OpenClaw's bootstrap will load it.
 */
function syncSoulToWorkspace(entry: RegistryEntry, workspaceDir: string): void {
  if (!entry.soulContent) {
    return;
  }

  mkdirSync(workspaceDir, { recursive: true });
  const targetPath = join(workspaceDir, "SOUL.md");

  // Only write if content differs (avoids unnecessary disk writes on every config load)
  if (existsSync(targetPath)) {
    const existing = readFileSync(targetPath, "utf-8");
    if (existing === entry.soulContent) {
      return;
    }
  }

  writeFileSync(targetPath, entry.soulContent);
}

/**
 * Ensure the memory.md exists in the workspace (for onboarding marker).
 */
function ensureMemoryFile(workspaceDir: string): void {
  const memPath = join(workspaceDir, "memory.md");
  if (!existsSync(memPath)) {
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(memPath, "ONBOARDING_NEEDED\n");
  }
}

/**
 * Map an agent definition to an OpenClaw agent list entry.
 */
function mapAgentToConfig(
  entry: RegistryEntry,
  stateDir: string,
  isDefault: boolean,
): AgentConfigFragment {
  const def = entry.definition;
  const workspaceDir = resolve(stateDir, `workspace-${def.metadata.name}`);

  syncSoulToWorkspace(entry, workspaceDir);
  ensureMemoryFile(workspaceDir);

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
    ...(toolsAllow || toolsDeny
      ? {
          tools: {
            ...(toolsAllow ? { alsoAllow: toolsAllow } : {}),
            ...(toolsDeny ? { deny: toolsDeny } : {}),
          },
        }
      : {}),
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
 * Re-read SOUL.md for each agent and sync to workspace.
 * Called on every config load so edits are picked up without restart.
 */
function syncAllSouls(repoRoot: string, stateDir: string, overlay: PlatformConfigOverlay): void {
  const defsDir = join(repoRoot, "agents", "definitions");
  for (const agent of overlay.agents.list) {
    const soulPath = join(defsDir, agent.id, "SOUL.md");
    if (existsSync(soulPath)) {
      const content = readFileSync(soulPath, "utf-8");
      const targetPath = join(agent.workspace, "SOUL.md");
      mkdirSync(agent.workspace, { recursive: true });
      if (!existsSync(targetPath) || readFileSync(targetPath, "utf-8") !== content) {
        writeFileSync(targetPath, content);
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

  // Cache hit: overlay structure unchanged, but still re-sync SOUL.md
  if (overlayCache && overlayCache.stateDir === stateDir && overlayCache.mtimeKey === mtimeKey) {
    syncAllSouls(repoRoot, stateDir, overlayCache.overlay);
    return overlayCache.overlay;
  }

  const registry = loadAgentRegistry(repoRoot);

  if (registry.agents.length === 0) {
    return null;
  }

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
    mapAgentToConfig(entry, stateDir, idx === defaultIdx),
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

  // Configure inter-agent communication ACLs on the message bus
  const bus = getAgentMessageBus();
  for (const entry of registry.agents) {
    const canContact = entry.definition.spec.collaboration?.canContact ?? [];
    bus.setAcl(entry.definition.metadata.name, canContact);
  }

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
