/**
 * Persists Sonance SSO tokens (id_token, access_token, refresh_token)
 * to ~/.openclaw/sonance-session.json.
 *
 * All functions are synchronous to match the callsite expectations in the
 * GatewayClient (token must be available before opening the WebSocket).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type SonanceTokenSet = {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch seconds when the access_token expires. */
  expiresAt?: number;
  /** The Entra ID tenant used to obtain these tokens. */
  tenantId?: string;
  /** Scopes granted. */
  scopes?: string[];
};

const SESSION_FILE = "sonance-session.json";

function sessionPath(): string {
  const dir = resolveStateDir();
  return join(dir, SESSION_FILE);
}

export function loadSonanceTokens(): SonanceTokenSet | null {
  const p = sessionPath();
  if (!existsSync(p)) {
    return null;
  }
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.idToken !== "string" || typeof parsed.accessToken !== "string") {
      return null;
    }
    return {
      idToken: parsed.idToken,
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined,
      tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : undefined,
      scopes: Array.isArray(parsed.scopes) ? (parsed.scopes as string[]) : undefined,
    };
  } catch {
    return null;
  }
}

export function saveSonanceTokens(tokens: SonanceTokenSet): void {
  const p = sessionPath();
  const dir = resolveStateDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearSonanceTokens(): void {
  const p = sessionPath();
  try {
    unlinkSync(p);
  } catch {
    // already gone
  }
}

/**
 * Returns the stored id_token if it exists and the access_token hasn't
 * expired.  Returns null if no session or tokens are stale.
 */
export function loadSonanceIdToken(): string | null {
  const tokens = loadSonanceTokens();
  if (!tokens) {
    return null;
  }
  if (tokens.expiresAt && tokens.expiresAt < Math.floor(Date.now() / 1000) - 60) {
    return null;
  }
  return tokens.idToken;
}
