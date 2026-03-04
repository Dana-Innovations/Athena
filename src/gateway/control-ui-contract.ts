export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";

export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAgentId: string;
  /** Gateway auth mode, so the UI knows whether to show a login flow. */
  authMode?: string;
  /** Cortex URL for SSO login flow (only set when authMode is "cortex"). */
  cortexUrl?: string;
  /** Supabase project URL for direct auth (only set when authMode is "cortex"). */
  supabaseUrl?: string;
  /** Supabase anonymous/publishable key for direct auth (only set when authMode is "cortex"). */
  supabaseAnonKey?: string;
  /** SSO email domain for Supabase SAML SSO (e.g. "sonance.com"). */
  ssoDomain?: string;
  /** AI Intranet URL for redirect-based SSO (e.g. "https://aiintranet.sonance.com"). */
  aiIntranetUrl?: string;
  /** Application ID in the AI Intranet for central-check validation. */
  appId?: string;
  /** WebSocket URL for the gateway when UI is hosted separately (e.g. "wss://elmo-cortex.fly.dev"). */
  gatewayUrl?: string;
};
