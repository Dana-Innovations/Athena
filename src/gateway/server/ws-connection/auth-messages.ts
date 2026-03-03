import { isGatewayCliClient, isWebchatClient } from "../../../utils/message-channel.js";
import type { ResolvedGatewayAuth } from "../../auth.js";
import { GATEWAY_CLIENT_IDS } from "../../protocol/client-info.js";

export type AuthProvidedKind = "token" | "password" | "none";

export function formatGatewayAuthFailureMessage(params: {
  authMode: ResolvedGatewayAuth["mode"];
  authProvided: AuthProvidedKind;
  reason?: string;
  client?: { id?: string | null; mode?: string | null };
}): string {
  const { authMode, authProvided, reason, client } = params;
  const isCli = isGatewayCliClient(client);
  const isControlUi = client?.id === GATEWAY_CLIENT_IDS.CONTROL_UI;
  const isWebchat = isWebchatClient(client);
  const uiHint = "open the dashboard URL and paste the token in Control UI settings";
  const tokenHint = isCli
    ? "set gateway.remote.token to match gateway.auth.token"
    : isControlUi || isWebchat
      ? uiHint
      : "provide gateway auth token";
  const passwordHint = isCli
    ? "set gateway.remote.password to match gateway.auth.password"
    : isControlUi || isWebchat
      ? "enter the password in Control UI settings"
      : "provide gateway auth password";
  switch (reason) {
    case "token_missing":
      return `unauthorized: gateway token missing (${tokenHint})`;
    case "token_mismatch":
      return `unauthorized: gateway token mismatch (${tokenHint})`;
    case "token_missing_config":
      return "unauthorized: gateway token not configured on gateway (set gateway.auth.token)";
    case "password_missing":
      return `unauthorized: gateway password missing (${passwordHint})`;
    case "password_mismatch":
      return `unauthorized: gateway password mismatch (${passwordHint})`;
    case "password_missing_config":
      return "unauthorized: gateway password not configured on gateway (set gateway.auth.password)";
    case "tailscale_user_missing":
      return "unauthorized: tailscale identity missing (use Tailscale Serve auth or gateway token/password)";
    case "tailscale_proxy_missing":
      return "unauthorized: tailscale proxy headers missing (use Tailscale Serve or gateway token/password)";
    case "tailscale_whois_failed":
      return "unauthorized: tailscale identity check failed (use Tailscale Serve auth or gateway token/password)";
    case "tailscale_user_mismatch":
      return "unauthorized: tailscale identity mismatch (use Tailscale Serve auth or gateway token/password)";
    case "rate_limited":
      return "unauthorized: too many failed authentication attempts (retry later)";
    case "device_token_mismatch":
      return "unauthorized: device token mismatch (rotate/reissue device token)";
    case "sonance_sso_config_missing":
      return "unauthorized: Sonance SSO not configured (set gateway.auth.sonanceSso)";
    case "cortex_config_missing":
      return "unauthorized: Cortex auth not configured (set gateway.auth.cortex)";
    case "cortex_jwt_missing":
      return "unauthorized: Cortex auth token missing (sign in via the Control UI)";
    default:
      break;
  }

  if (reason?.startsWith("sonance-sso:") || reason?.startsWith("JWT ")) {
    return `unauthorized: ${reason}`;
  }

  if (authMode === "sonance-sso" && authProvided === "none") {
    return "unauthorized: Sonance SSO token missing (ensure reverse proxy forwards the token header)";
  }
  if (authMode === "cortex" && authProvided === "none") {
    return "unauthorized: Cortex auth token missing (sign in via the Control UI)";
  }
  if (authMode === "token" && authProvided === "none") {
    return `unauthorized: gateway token missing (${tokenHint})`;
  }
  if (authMode === "password" && authProvided === "none") {
    return `unauthorized: gateway password missing (${passwordHint})`;
  }
  return "unauthorized";
}
