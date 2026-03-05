/**
 * Platform agent validation and listing — powers the CLI commands.
 */
import { resolve } from "node:path";
import { AthenaSqliteProvider } from "./database/sqlite-provider.js";
import { loadAgentRegistry, type RegistryLoadResult } from "./registry.js";

export type ValidateResult = {
  registry: RegistryLoadResult;
  dbInitialized: boolean;
  dbPath: string | null;
  dbStats: Record<string, number> | null;
};

/**
 * Validate all agent definitions and optionally initialize the local database.
 */
export async function validatePlatform(opts: {
  rootDir: string;
  initDb?: boolean;
  dbPath?: string;
}): Promise<ValidateResult> {
  const registry = loadAgentRegistry(opts.rootDir);

  let dbInitialized = false;
  let dbPath: string | null = null;
  let dbStats: Record<string, number> | null = null;

  if (opts.initDb) {
    dbPath = opts.dbPath ?? resolve(opts.rootDir, ".local-dev/athena.db");
    const provider = new AthenaSqliteProvider(dbPath);
    provider.initSchema();
    dbStats = provider.getTableStats();
    provider.close();
    dbInitialized = true;
  }

  return { registry, dbInitialized, dbPath, dbStats };
}

/**
 * Format validation results for CLI output.
 */
export function formatValidationReport(result: ValidateResult): string {
  const lines: string[] = [];
  const { registry } = result;

  lines.push("╔══════════════════════════════════════════════════════════╗");
  lines.push("║          Athena Platform — Agent Validation             ║");
  lines.push("╚══════════════════════════════════════════════════════════╝");
  lines.push("");

  if (registry.agents.length === 0 && registry.errors.length === 0) {
    lines.push("  No agent definitions found in agents/definitions/");
    lines.push(
      "  Create one with: mkdir -p agents/definitions/<name> && touch agents/definitions/<name>/agent.yaml",
    );
    return lines.join("\n");
  }

  // Valid agents
  if (registry.agents.length > 0) {
    lines.push(`  ✓ ${registry.agents.length} agent(s) validated successfully:`);
    lines.push("");
    for (const entry of registry.agents) {
      const def = entry.definition;
      const soul = entry.soulContent
        ? `${(entry.soulContent.length / 1024).toFixed(1)}KB`
        : "missing";
      lines.push(`    ┌─ ${def.metadata.displayName} (${def.metadata.name})`);
      lines.push(`    │  Owner:     ${def.metadata.owner}`);
      lines.push(
        `    │  Runtime:   ${def.spec.runtime.framework} / ${def.spec.runtime.model.primary}`,
      );
      lines.push(`    │  SOUL.md:   ${soul}`);
      if (def.spec.skills?.cortex) {
        lines.push(`    │  MCPs:      ${def.spec.skills.cortex.mcps.join(", ")}`);
      }
      const gateways = Object.entries(def.spec.gateways ?? {})
        .filter(([, v]) => v?.enabled)
        .map(([k]) => k);
      if (gateways.length > 0) {
        lines.push(`    │  Gateways:  ${gateways.join(", ")}`);
      }
      if (def.spec.cron && def.spec.cron.length > 0) {
        lines.push(`    │  Cron jobs: ${def.spec.cron.length}`);
      }
      if (def.spec.collaboration?.canContact?.length) {
        lines.push(`    │  Can talk to: ${def.spec.collaboration.canContact.join(", ")}`);
      }
      lines.push(`    │  Access:    ${def.spec.access.users.join(", ")}`);
      lines.push(`    └──────────────────────────────────────────`);
      lines.push("");
    }
  }

  // Errors
  if (registry.errors.length > 0) {
    lines.push(`  ✗ ${registry.errors.length} agent(s) failed validation:`);
    lines.push("");
    for (const err of registry.errors) {
      lines.push(`    ┌─ ${err.agentDir}`);
      for (const issue of err.issues) {
        lines.push(`    │  ✗ ${issue.path}: ${issue.message}`);
      }
      lines.push(`    └──────────────────────────────────────────`);
      lines.push("");
    }
  }

  // Database status
  if (result.dbInitialized && result.dbPath) {
    lines.push("  Database:");
    lines.push(`    Path:   ${result.dbPath}`);
    lines.push("    Status: initialized ✓");
    if (result.dbStats) {
      const tables = Object.keys(result.dbStats).length;
      lines.push(`    Tables: ${tables}`);
    }
    lines.push("");
  }

  // Summary line
  const total = registry.agents.length + registry.errors.length;
  const passed = registry.agents.length;
  if (registry.errors.length === 0) {
    lines.push(`  Result: ${passed}/${total} agents passed validation ✓`);
  } else {
    lines.push(`  Result: ${passed}/${total} agents passed, ${registry.errors.length} failed ✗`);
  }

  return lines.join("\n");
}

/**
 * Format a compact agent list for CLI output.
 */
export function formatAgentList(registry: RegistryLoadResult): string {
  const lines: string[] = [];

  if (registry.agents.length === 0) {
    return "No platform agents defined. Create one in agents/definitions/<name>/agent.yaml";
  }

  lines.push("");
  lines.push("  Name          Display Name         Owner                  MCPs        Gateways");
  lines.push("  ────          ────────────         ─────                  ────        ────────");

  for (const entry of registry.agents) {
    const d = entry.definition;
    const name = d.metadata.name.padEnd(14);
    const display = d.metadata.displayName.padEnd(21);
    const owner = d.metadata.owner.padEnd(23);
    const mcps = (d.spec.skills?.cortex?.mcps.join(", ") ?? "none").padEnd(12);
    const gateways =
      Object.entries(d.spec.gateways ?? {})
        .filter(([, v]) => v?.enabled)
        .map(([k]) => k)
        .join(", ") || "none";
    lines.push(`  ${name}${display}${owner}${mcps}${gateways}`);
  }

  lines.push("");
  lines.push(`  Total: ${registry.agents.length} agent(s)`);

  return lines.join("\n");
}
