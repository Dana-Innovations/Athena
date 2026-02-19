import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";
import type { SonanceUserIdentity } from "../sonance-sso.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  /** Sonance SSO identity (present when auth method is "sonance-sso"). */
  sonanceUser?: SonanceUserIdentity;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
};
