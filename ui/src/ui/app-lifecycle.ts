import { connectGateway } from "./app-gateway.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { observeTopbar, scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import {
  completeSsoCallback,
  getSsoCallbackCode,
  loadCortexAuth,
  type CortexAuthSession,
} from "./cortex-auth.ts";
import type { Tab } from "./navigation.ts";

type LifecycleHost = {
  basePath: string;
  tab: Tab;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  popStateHandler: () => void;
  topbarObserver: ResizeObserver | null;
  /** Gateway auth mode from bootstrap config. */
  authMode?: string;
  /** Cortex URL for SSO. */
  cortexUrl?: string;
  /** Supabase project URL. */
  supabaseUrl?: string;
  /** Supabase anon key. */
  supabaseAnonKey?: string;
  /** SSO email domain. */
  ssoDomain?: string;
  /** AI Intranet URL for redirect-based SSO. */
  aiIntranetUrl?: string;
  /** Application ID in the AI Intranet. */
  appId?: string;
  /** Gateway WebSocket URL override from bootstrap config. */
  gatewayUrl?: string;
  /** Cortex user session. */
  cortexUser?: CortexAuthSession | null;
  /** SSO login loading state. */
  cortexLoginLoading?: boolean;
  /** SSO login error. */
  cortexLoginError?: string | null;
  /** SSO login status message. */
  cortexLoginStatus?: string | null;
};

export function handleConnected(host: LifecycleHost) {
  host.basePath = inferBasePath();
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  attachThemeListener(host as unknown as Parameters<typeof attachThemeListener>[0]);
  window.addEventListener("popstate", host.popStateHandler);

  // Load bootstrap config first, then decide whether to connect.
  void loadControlUiBootstrapConfig(host).then(async () => {
    if (host.authMode === "cortex") {
      // Check for SSO callback (?auth_token=...) — returning from AI Intranet/Okta.
      const authToken = getSsoCallbackCode();
      if (authToken && host.aiIntranetUrl && host.appId) {
        host.cortexLoginLoading = true;
        try {
          host.cortexUser = await completeSsoCallback({
            aiIntranetUrl: host.aiIntranetUrl,
            appId: host.appId,
            authToken,
            supabaseUrl: host.supabaseUrl,
            onStatus: (status) => {
              host.cortexLoginStatus = status;
            },
          });
          host.cortexLoginStatus = null;
          if (host.gatewayUrl) {
            const appHost = host as unknown as { settings: import("./storage.ts").UiSettings };
            appHost.settings = { ...appHost.settings, gatewayUrl: host.gatewayUrl };
          }
          connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
        } catch (err) {
          host.cortexLoginError = err instanceof Error ? err.message : String(err);
        } finally {
          host.cortexLoginLoading = false;
        }
        return;
      }

      // No callback — check for existing stored session.
      const stored = loadCortexAuth();
      host.cortexUser = stored;
      if (!stored) {
        // No session — the UI will render the landing page instead of connecting.
        // Reset the URL to "/" since syncTabWithLocation already set it to "/dashboard".
        const bp = host.basePath || "";
        history.replaceState({}, "", bp || "/");
        return;
      }
    }
    if (host.gatewayUrl) {
      const appHost = host as unknown as { settings: import("./storage.ts").UiSettings };
      appHost.settings = { ...appHost.settings, gatewayUrl: host.gatewayUrl };
    }
    connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  });

  startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
  if (host.tab === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  }
  if (host.tab === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
}

export function handleDisconnected(host: LifecycleHost) {
  window.removeEventListener("popstate", host.popStateHandler);
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || !host.chatHasAutoScrolled,
    );
  }
  if (
    host.tab === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
}
