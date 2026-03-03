/**
 * Cortex Skills provider hook.
 *
 * Follows the same process-global symbol pattern used by model-auth.ts
 * (setSonanceCentralKeyResolver) so the Cortex plugin can register a
 * provider and the system prompt builder can call it.
 */

export type CortexSkillsPromptResult = {
  prompt: string;
  skillCount: number;
  ruleCount: number;
};

export type SonanceCortexSkillsProvider = () => Promise<CortexSkillsPromptResult | null>;

const PROVIDER_SYM = Symbol.for("sonance.cortexSkillsProvider");

function getProvider(): SonanceCortexSkillsProvider | undefined {
  return (globalThis as Record<symbol, SonanceCortexSkillsProvider | undefined>)[PROVIDER_SYM];
}

/**
 * Register a Cortex skills provider (called by the sonance-cortex plugin).
 * Returns a teardown function.
 */
export function setSonanceCortexSkillsProvider(provider: SonanceCortexSkillsProvider): () => void {
  const previous = getProvider();
  (globalThis as Record<symbol, SonanceCortexSkillsProvider | undefined>)[PROVIDER_SYM] = provider;
  return () => {
    (globalThis as Record<symbol, SonanceCortexSkillsProvider | undefined>)[PROVIDER_SYM] =
      previous;
  };
}

/**
 * Fetch the Cortex skills prompt for system prompt injection.
 *
 * Returns the formatted prompt string, or empty string if Cortex is
 * unreachable or no provider is registered (graceful degradation).
 */
export async function fetchCortexSkillsPrompt(): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    return "";
  }
  try {
    const result = await provider();
    return result?.prompt?.trim() ?? "";
  } catch {
    return "";
  }
}
