/**
 * Sonance Fork — Configuration Defaults
 *
 * Centralizes all Sonance-specific configuration overrides that diverge from
 * upstream OpenClaw defaults.  Consumed during config resolution so that a
 * fresh install or empty config file behaves correctly for Sonance employees
 * without requiring manual tuning.
 *
 * These can always be overridden by explicit entries in openclaw.json.
 */

/**
 * All channel plugin IDs that Sonance does not use.
 * These are added to `plugins.deny` at config resolution time so the plugins
 * never load — but the source code stays intact for upstream merge tracking.
 */
export const SONANCE_DENIED_CHANNEL_PLUGINS = [
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
  "bluebubbles",
  "msteams",
  "matrix",
  "zalo",
  "zalouser",
  "feishu",
  "line",
  "nostr",
  "twitch",
  "mattermost",
  "nextcloud-talk",
  "tlon",
  "voice-call",
] as const;

/**
 * Merge Sonance defaults into a loaded config.
 * Only injects defaults where the user has not explicitly configured values.
 */
export function applySonanceDefaults<T extends Record<string, unknown>>(config: T): T {
  const plugins = (config.plugins ?? {}) as Record<string, unknown>;
  const existingDeny = Array.isArray(plugins.deny) ? (plugins.deny as string[]) : [];

  const mergedDeny = Array.from(new Set([...existingDeny, ...SONANCE_DENIED_CHANNEL_PLUGINS]));

  const entries = (plugins.entries ?? {}) as Record<string, unknown>;
  const cortexEntry = (entries["sonance-cortex"] ?? {}) as Record<string, unknown>;

  // Gateway auth defaults: "none" for local PoC, user upgrades to "sonance-sso"
  // when moving to a shared/centralized gateway.
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const gatewayAuth = (gateway.auth ?? {}) as Record<string, unknown>;
  const mergedGateway = {
    ...gateway,
    auth: {
      ...gatewayAuth,
      mode: gatewayAuth.mode ?? "none",
    },
  };

  // Apollo proxy mode: when the Cortex plugin has apolloBaseUrl configured,
  // point the Anthropic provider at Apollo so all AI requests go through
  // Cortex (rate limiting, billing, usage tracking).
  const cortexConfig = (cortexEntry.config ?? {}) as Record<string, unknown>;
  const apolloBaseUrl =
    (typeof cortexConfig.apolloBaseUrl === "string" && cortexConfig.apolloBaseUrl.trim()) ||
    process.env.SONANCE_APOLLO_BASE_URL?.trim() ||
    "";

  const models = (config.models ?? {}) as Record<string, unknown>;
  const providers = (models.providers ?? {}) as Record<string, Record<string, unknown>>;
  const anthropicProvider = providers.anthropic ?? {};

  const mergedModels = apolloBaseUrl
    ? {
        ...models,
        providers: {
          ...providers,
          anthropic: {
            ...anthropicProvider,
            baseUrl: anthropicProvider.baseUrl ?? apolloBaseUrl,
          },
        },
      }
    : models;

  return {
    ...config,
    gateway: mergedGateway,
    models: Object.keys(mergedModels).length > 0 ? mergedModels : undefined,
    plugins: {
      ...plugins,
      deny: mergedDeny,
      entries: {
        ...entries,
        "sonance-cortex": {
          ...cortexEntry,
          enabled: cortexEntry.enabled ?? true,
        },
      },
    },
  };
}
