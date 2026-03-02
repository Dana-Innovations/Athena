import {
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  type ControlUiBootstrapConfig,
} from "../../../../src/gateway/control-ui-contract.js";
import { normalizeAssistantIdentity } from "../assistant-identity.ts";
import { normalizeBasePath } from "../navigation.ts";

export type ControlUiBootstrapState = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  /** Gateway auth mode from server bootstrap config. */
  authMode?: string;
  /** Cortex URL for SSO login (only set when authMode is "cortex"). */
  cortexUrl?: string;
  /** Supabase project URL for direct auth (only set when authMode is "cortex"). */
  supabaseUrl?: string;
  /** Supabase anon key for direct auth (only set when authMode is "cortex"). */
  supabaseAnonKey?: string;
  /** SSO email domain (e.g. "sonance.com"). */
  ssoDomain?: string;
  /** AI Intranet URL for redirect-based SSO. */
  aiIntranetUrl?: string;
  /** Application ID in the AI Intranet. */
  appId?: string;
};

export async function loadControlUiBootstrapConfig(state: ControlUiBootstrapState) {
  if (typeof window === "undefined") {
    return;
  }
  if (typeof fetch !== "function") {
    return;
  }

  const basePath = normalizeBasePath(state.basePath ?? "");
  const url = basePath
    ? `${basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
    : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      return;
    }
    const parsed = (await res.json()) as ControlUiBootstrapConfig;
    const normalized = normalizeAssistantIdentity({
      agentId: parsed.assistantAgentId ?? null,
      name: parsed.assistantName,
      avatar: parsed.assistantAvatar ?? null,
    });
    state.assistantName = normalized.name;
    state.assistantAvatar = normalized.avatar;
    state.assistantAgentId = normalized.agentId ?? null;
    state.authMode = parsed.authMode;
    state.cortexUrl = parsed.cortexUrl;
    state.supabaseUrl = parsed.supabaseUrl;
    state.supabaseAnonKey = parsed.supabaseAnonKey;
    state.ssoDomain = parsed.ssoDomain;
    state.aiIntranetUrl = parsed.aiIntranetUrl;
    state.appId = parsed.appId;
  } catch {
    // Ignore bootstrap failures; UI will update identity after connecting.
  }
}
