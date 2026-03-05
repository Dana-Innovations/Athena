/**
 * Platform Agent Router
 *
 * Resolves which agent should handle an inbound message using:
 *   1. Intent classification — matches message content against each agent's
 *      declared intentKeywords (from agent.yaml routing section)
 *   2. Explicit command prefix — !agent or @agent as a manual override
 *   3. Default agent — the agent with routing.isDefault: true
 *
 * Users never need to type commands. They just talk naturally and the
 * router sends the message to the right agent.
 */
import { loadAgentRegistry, findAgent, type RegistryLoadResult } from "./registry.js";

export type AgentRouteResult = {
  agentId: string;
  matchedBy: "intent" | "command" | "default";
  strippedBody: string;
  isSwitchCommand: boolean;
};

type IntentRule = {
  agentId: string;
  displayName: string;
  keywords: string[];
  priority: number;
};

const AGENT_PREFIX_RE = /^[!@](\S+)/;

/**
 * Cached intent rules built from agent definitions.
 * Rebuilt when the registry changes (mtime-based, same as adapter).
 */
let intentRulesCache: { rules: IntentRule[]; defaultAgentId: string } | null = null;
let lastRegistryFingerprint = "";

function buildIntentRules(registry: RegistryLoadResult): {
  rules: IntentRule[];
  defaultAgentId: string;
} {
  const rules: IntentRule[] = [];
  let defaultAgentId = "";

  for (const entry of registry.agents) {
    const def = entry.definition;
    const routing = def.spec.routing;

    if (routing?.isDefault) {
      defaultAgentId = def.metadata.name;
    }

    const keywords = routing?.intentKeywords;
    if (keywords && keywords.length > 0) {
      rules.push({
        agentId: def.metadata.name,
        displayName: def.metadata.displayName,
        keywords: keywords.map((k) => k.toLowerCase()),
        priority: routing?.priority ?? 0,
      });
    }
  }

  // If no agent is explicitly marked default, use the first one
  if (!defaultAgentId && registry.agents.length > 0) {
    defaultAgentId = registry.agents[0].definition.metadata.name;
  }

  // Higher priority checked first
  rules.sort((a, b) => b.priority - a.priority);
  return { rules, defaultAgentId };
}

function getIntentRules(registryRoot: string): {
  rules: IntentRule[];
  defaultAgentId: string;
} {
  const registry = loadAgentRegistry(registryRoot);
  const fingerprint = registry.agents.map((e) => e.definitionPath).join("|");

  if (intentRulesCache && fingerprint === lastRegistryFingerprint) {
    return intentRulesCache;
  }

  const result = buildIntentRules(registry);
  intentRulesCache = result;
  lastRegistryFingerprint = fingerprint;
  return result;
}

/**
 * Classify the message against intent keywords.
 * Returns the best-matching agent or null.
 */
function classifyIntent(text: string, rules: IntentRule[]): IntentRule | null {
  const lower = text.toLowerCase();

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        return rule;
      }
    }
  }

  return null;
}

/**
 * Resolve which agent should handle this message.
 *
 * Priority order:
 *   1. Explicit prefix (!scheduler, @scheduler) — manual override
 *   2. Intent classification — keyword match from agent.yaml
 *   3. Default agent — the catch-all
 */
export function resolveAgentFromMessage(
  messageBody: string,
  userId: string,
  registryRoot: string,
): AgentRouteResult | null {
  const trimmed = messageBody.trim();
  const { rules, defaultAgentId } = getIntentRules(registryRoot);

  // 1. Explicit agent prefix (escape hatch — still works if needed)
  const commandResult = tryParseAgentPrefix(trimmed, registryRoot);
  if (commandResult) {
    return commandResult;
  }

  // 2. Intent classification
  const intentMatch = classifyIntent(trimmed, rules);
  if (intentMatch) {
    return {
      agentId: intentMatch.agentId,
      matchedBy: "intent",
      strippedBody: trimmed,
      isSwitchCommand: false,
    };
  }

  // 3. Default agent
  if (defaultAgentId) {
    return {
      agentId: defaultAgentId,
      matchedBy: "default",
      strippedBody: trimmed,
      isSwitchCommand: false,
    };
  }

  return null;
}

/**
 * Check if the message starts with !agentName or @agentName.
 * This is the manual override — still available but not the primary UX.
 */
function tryParseAgentPrefix(text: string, registryRoot: string): AgentRouteResult | null {
  const match = AGENT_PREFIX_RE.exec(text);
  if (!match) {
    return null;
  }

  const potentialAgent = match[1].toLowerCase();
  const registry = loadAgentRegistry(registryRoot);
  const agent = findAgent(registry, potentialAgent);
  if (!agent) {
    return null;
  }

  const prefixLength = match[0].length;
  const strippedBody = text.slice(prefixLength).trim();

  return {
    agentId: agent.definition.metadata.name,
    matchedBy: "command",
    strippedBody: strippedBody || `(routed to ${agent.definition.metadata.displayName})`,
    isSwitchCommand: false,
  };
}

/**
 * Get the user's currently active agent session, if any.
 * (Kept for backward compat but no longer primary routing mechanism.)
 */
export function getActiveAgent(_userId: string): string | undefined {
  return undefined;
}

/**
 * Clear the user's active agent session (no-op now, kept for compat).
 */
export function clearActiveAgent(_userId: string): void {
  // Intent-based routing doesn't use sticky sessions
}

/**
 * Handle the !agents list command.
 */
export function handleAgentsListCommand(registryRoot: string): string {
  const registry = loadAgentRegistry(registryRoot);

  if (registry.agents.length === 0) {
    return "No agents registered.";
  }

  const lines = registry.agents.map((entry) => {
    const def = entry.definition;
    const isDefault = def.spec.routing?.isDefault ? " *(default)*" : "";
    const keywords = def.spec.routing?.intentKeywords;
    const keywordPreview = keywords
      ? `\n  Routes on: ${keywords
          .slice(0, 5)
          .map((k) => `"${k}"`)
          .join(", ")}${keywords.length > 5 ? `, +${keywords.length - 5} more` : ""}`
      : "";
    return `- **${def.metadata.displayName}**${isDefault} — ${def.metadata.description}${keywordPreview}`;
  });

  return `**Available Agents** (${registry.agents.length})\n\n${lines.join("\n\n")}\n\nMessages are automatically routed to the right agent based on what you ask. You can also use \`!<agent> <message>\` to target one directly.`;
}
