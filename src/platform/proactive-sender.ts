/**
 * Proactive message sender — platform bridge.
 *
 * The platform's bus delegate handler needs to deliver the specialist agent's
 * response to the user after the LLM finishes. Since the bus runs outside the
 * normal channel turn (fire-and-forget), it can't use the active context.
 *
 * The gateway (Teams plugin) sets a concrete sender implementation at startup.
 * The bus handler calls `getProactiveSender()` to get it.
 *
 * If no sender is registered (non-Teams deployment) the response is just logged.
 */

export type ProactiveSender = {
  /**
   * Send a message to a user by their gateway user ID.
   * Falls back to a log-only no-op if the user has no stored conversation ref.
   */
  sendToUser(userId: string, text: string, agentDisplayName?: string): Promise<void>;
};

// Use a globalThis symbol so that the dist/ build (used by the installed
// msteams plugin via openclaw/plugin-sdk) and the tsx-loaded src/ copy share
// the exact same sender reference across module instances.
const SENDER_KEY = Symbol.for("openclaw.platform.proactiveSender");

function _get(): ProactiveSender | null {
  return ((globalThis as Record<symbol, unknown>)[SENDER_KEY] as ProactiveSender | null) ?? null;
}

export function setProactiveSender(sender: ProactiveSender): void {
  (globalThis as Record<symbol, unknown>)[SENDER_KEY] = sender;
  console.log("[platform] proactive sender registered");
}

export function getProactiveSender(): ProactiveSender {
  return (
    _get() ?? {
      async sendToUser(userId, text, agentDisplayName) {
        console.log(
          `[platform] proactive message (no sender registered) → ${userId} from ${agentDisplayName ?? "agent"}: ${text.slice(0, 120)}`,
        );
      },
    }
  );
}
