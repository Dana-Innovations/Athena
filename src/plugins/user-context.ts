/**
 * Per-request user context propagation for plugin tool execution.
 *
 * Plugins (e.g. sonance-cortex) need the end-user's identity to scope
 * API calls correctly.  The tool `execute()` signature doesn't carry
 * user info, so we use AsyncLocalStorage to propagate it through the
 * async call chain without changing the interface.
 *
 * IMPORTANT: Extensions are loaded by jiti (separate module cache from
 * Node's native ESM loader).  A plain module-level export would create
 * two independent AsyncLocalStorage instances — one per loader — so
 * context set in the core app would be invisible to extension code.
 * Using a globalThis singleton ensures both loaders share the same
 * instance.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type PluginUserContext = {
  senderId?: string;
  senderName?: string;
};

const GLOBAL_KEY = "__openclaw_plugin_user_store__";

const g = globalThis as unknown as Record<string, unknown>;
export const pluginUserStore: AsyncLocalStorage<PluginUserContext> =
  (g[GLOBAL_KEY] as AsyncLocalStorage<PluginUserContext>) ??
  (g[GLOBAL_KEY] = new AsyncLocalStorage<PluginUserContext>());
