/**
 * Sonance User Context
 *
 * Thread-safe store that maps session keys to authenticated Sonance user
 * identities. Populated by the gateway auth layer when `sonance-sso` mode
 * succeeds, and consumed by:
 *   - The audit logger (Phase 1) to tag events with the user id.
 *   - The Cortex plugin (Phase 3) for billing and ABAC policy checks.
 *
 * Entries are evicted when sessions end or after a configurable TTL.
 */

import type { SonanceUserIdentity } from "./sonance-sso.js";

const sessionUserMap = new Map<string, SonanceUserIdentity>();
const MAX_ENTRIES = 4096;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type TimedEntry = { identity: SonanceUserIdentity; expiresAt: number };
const timedMap = new Map<string, TimedEntry>();

function evictExpired(): void {
  if (timedMap.size <= MAX_ENTRIES / 2) {
    return;
  }
  const now = Date.now();
  for (const [key, entry] of timedMap) {
    if (entry.expiresAt < now) {
      timedMap.delete(key);
      sessionUserMap.delete(key);
    }
  }
}

/**
 * Associate a Sonance user identity with a session key.
 * Called by the gateway after successful `sonance-sso` authentication.
 */
export function setSonanceSessionUser(sessionKey: string, identity: SonanceUserIdentity): void {
  evictExpired();
  sessionUserMap.set(sessionKey, identity);
  timedMap.set(sessionKey, { identity, expiresAt: Date.now() + TTL_MS });

  if (sessionUserMap.size > MAX_ENTRIES) {
    const oldest = sessionUserMap.keys().next().value;
    if (oldest) {
      sessionUserMap.delete(oldest);
      timedMap.delete(oldest);
    }
  }
}

/**
 * Retrieve the Sonance user identity for a session key.
 * Returns undefined if no identity is associated or it has expired.
 */
export function getSonanceSessionUser(sessionKey: string): SonanceUserIdentity | undefined {
  const timed = timedMap.get(sessionKey);
  if (!timed) {
    return undefined;
  }
  if (timed.expiresAt < Date.now()) {
    timedMap.delete(sessionKey);
    sessionUserMap.delete(sessionKey);
    return undefined;
  }
  return timed.identity;
}

/**
 * Remove the Sonance user identity for a session key (e.g. on session end).
 */
export function clearSonanceSessionUser(sessionKey: string): void {
  sessionUserMap.delete(sessionKey);
  timedMap.delete(sessionKey);
}

/**
 * Get the user id for a session, if one is set. Convenience for audit logging.
 */
export function getSonanceUserId(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) {
    return undefined;
  }
  return getSonanceSessionUser(sessionKey)?.userId;
}
