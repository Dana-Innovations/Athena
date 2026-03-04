/**
 * Athena Agent Registry
 *
 * Loads agent definitions from YAML files in agents/definitions/,
 * validates them, and provides lookup by name or alias.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { type AgentDefinition, type ValidationResult, validateAgentDefinition } from "./schema.js";

export type RegistryEntry = {
  definition: AgentDefinition;
  definitionPath: string;
  soulPath: string | null;
  soulContent: string | null;
};

export type RegistryLoadResult = {
  agents: RegistryEntry[];
  errors: Array<{ agentDir: string; issues: Array<{ path: string; message: string }> }>;
};

const DEFINITIONS_DIR = "agents/definitions";

/**
 * Load all agent definitions from the given root directory.
 * Returns both successfully loaded agents and any validation errors.
 */
export function loadAgentRegistry(rootDir: string): RegistryLoadResult {
  const defsDir = resolve(rootDir, DEFINITIONS_DIR);
  const agents: RegistryEntry[] = [];
  const errors: RegistryLoadResult["errors"] = [];

  if (!existsSync(defsDir)) {
    return { agents, errors };
  }

  const entries = readdirSync(defsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const agentDir = join(defsDir, entry.name);
    const yamlPath = join(agentDir, "agent.yaml");

    if (!existsSync(yamlPath)) {
      errors.push({
        agentDir,
        issues: [{ path: "agent.yaml", message: "File not found" }],
      });
      continue;
    }

    const raw = readFileSync(yamlPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      errors.push({
        agentDir,
        issues: [
          {
            path: "agent.yaml",
            message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      });
      continue;
    }

    const result: ValidationResult = validateAgentDefinition(parsed);
    if (!result.ok) {
      errors.push({ agentDir, issues: result.errors });
      continue;
    }

    const soulRelPath = result.agent.spec.identity?.soulPath ?? "./SOUL.md";
    const soulAbsPath = resolve(agentDir, soulRelPath);
    const soulExists = existsSync(soulAbsPath);

    agents.push({
      definition: result.agent,
      definitionPath: yamlPath,
      soulPath: soulExists ? soulAbsPath : null,
      soulContent: soulExists ? readFileSync(soulAbsPath, "utf-8") : null,
    });
  }

  return { agents, errors };
}

/**
 * Find an agent by name or alias.
 */
export function findAgent(
  registry: RegistryLoadResult,
  nameOrAlias: string,
): RegistryEntry | undefined {
  const needle = nameOrAlias.toLowerCase().replace(/^@/, "");
  return registry.agents.find((entry) => {
    const def = entry.definition;
    if (def.metadata.name === needle) {
      return true;
    }
    return def.metadata.aliases?.some((a) => a.toLowerCase().replace(/^@/, "") === needle);
  });
}

/**
 * Get all agent names from the registry.
 */
export function listAgentNames(registry: RegistryLoadResult): string[] {
  return registry.agents.map((entry) => entry.definition.metadata.name);
}
