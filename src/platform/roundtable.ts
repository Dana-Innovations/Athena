/**
 * Roundtable — Multi-Agent Group Chat Coordinator
 *
 * When a user addresses multiple agents in a single message
 * (e.g. "@athena @scheduler let's plan next week"), the Roundtable
 * coordinator fans the message out to each addressed agent via the
 * message bus and delivers their responses sequentially to the user.
 *
 * Phase 6.2 implementation.
 */

import { getAgentMessageBus } from "./message-bus.js";
import { loadAgentRegistry } from "./registry.js";

export type RoundtableParticipant = {
  agentId: string;
  displayName: string;
};

export type RoundtableResponse = {
  agentId: string;
  displayName: string;
  text: string;
  durationMs: number;
  error?: string;
};

export type RoundtableResult = {
  sessionId: string;
  participants: RoundtableParticipant[];
  responses: RoundtableResponse[];
  totalDurationMs: number;
};

const ROUNDTABLE_TIMEOUT_MS = 45_000;

let sessionCounter = 0;
function newSessionId(): string {
  return `rt_${++sessionCounter}_${Date.now()}`;
}

/**
 * Fan out a message to multiple agents and collect their responses.
 *
 * Each agent is queried in parallel. Responses are sorted in the order
 * the agents were listed (not arrival order) for a consistent experience.
 *
 * @param agentIds  - Ordered list of agent IDs to include
 * @param message   - The user's message (stripped of mention tags)
 * @param userId    - The user's ID (for context propagation)
 * @param fromAgent - The agent initiating the roundtable (or "roundtable")
 */
export async function coordinateRoundtable(
  agentIds: string[],
  message: string,
  userId: string,
  fromAgent = "roundtable",
): Promise<RoundtableResult> {
  const sessionId = newSessionId();
  const startAt = Date.now();
  const bus = getAgentMessageBus();

  const tasks = agentIds.map(async (agentId): Promise<RoundtableResponse> => {
    const agentStart = Date.now();
    const displayName = agentId;
    try {
      if (!bus.isRegistered(agentId)) {
        return {
          agentId,
          displayName,
          text: `${displayName} is currently offline.`,
          durationMs: Date.now() - agentStart,
          error: "offline",
        };
      }
      const reply = await bus.query(
        fromAgent,
        agentId,
        { question: message, roundtableSessionId: sessionId },
        { userId, timeoutMs: ROUNDTABLE_TIMEOUT_MS },
      );
      const text = reply.error
        ? `${displayName} encountered an error: ${reply.error}`
        : typeof reply.payload.answer === "string"
          ? reply.payload.answer
          : JSON.stringify(reply.payload);
      return { agentId, displayName, text, durationMs: Date.now() - agentStart };
    } catch (err) {
      return {
        agentId,
        displayName,
        text: `${displayName} could not respond: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - agentStart,
        error: String(err),
      };
    }
  });

  const responses = await Promise.all(tasks);

  return {
    sessionId,
    participants: agentIds.map((id) => ({ agentId: id, displayName: id })),
    responses,
    totalDurationMs: Date.now() - startAt,
  };
}

/**
 * Detect agent aliases in a Teams message (raw HTML, before mention-stripping).
 *
 * Teams encodes bot mentions as `<at>DisplayName</at>`. This function
 * extracts all mentioned display names and cross-references them against
 * the agent registry's aliases and displayNames to return the matching
 * agent IDs.
 *
 * Returns an empty array if fewer than 2 agents are mentioned (use normal
 * single-agent routing in that case).
 */
export function detectRoundtableAgents(rawHtml: string, registryRoot: string): string[] {
  // Extract all <at>...</at> mention texts from raw Teams HTML
  const mentionPattern = /<at[^>]*>([^<]+)<\/at>/gi;
  const mentionedNames: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(rawHtml)) !== null) {
    mentionedNames.push(match[1].trim().toLowerCase());
  }

  if (mentionedNames.length < 2) {
    return [];
  }

  try {
    const registry = loadAgentRegistry(registryRoot);
    const matched = new Set<string>();

    for (const entry of registry.agents) {
      const def = entry.definition;
      const agentId = def.metadata.name;
      const displayNameLower = def.metadata.displayName.toLowerCase();
      const aliasesLower = new Set(
        (def.metadata.aliases ?? []).map((a: string) => a.replace(/^@/, "").toLowerCase()),
      );

      for (const mentioned of mentionedNames) {
        const cleanMentioned = mentioned.replace(/^@/, "");
        if (
          cleanMentioned === displayNameLower ||
          cleanMentioned === agentId.toLowerCase() ||
          aliasesLower.has(cleanMentioned)
        ) {
          matched.add(agentId);
          break;
        }
      }
    }

    return matched.size >= 2 ? [...matched] : [];
  } catch {
    return [];
  }
}

/**
 * Format a roundtable result as a human-readable Teams message.
 * Each agent's response is prefixed with their display name.
 */
export function formatRoundtableResponse(result: RoundtableResult): string {
  const lines: string[] = [];
  for (const response of result.responses) {
    lines.push(`**${response.displayName}:**`);
    lines.push(response.text);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
