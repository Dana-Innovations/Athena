/**
 * Sonance SSO — JWT-based gateway authentication.
 *
 * Flow: reverse proxy (nginx / Caddy / API gateway) handles the Sonance IdP
 * login and forwards the signed JWT in a configurable HTTP header.  This module
 * validates the JWT and extracts user identity claims for downstream session
 * and audit usage.
 *
 * Supports both:
 *   - HS256 symmetric secret (`jwtSecret`)
 *   - RS256/ES256 via JWKS endpoint (`jwksUri`) — preferred for production
 *
 * The JWKS client caches keys for 10 minutes to avoid hitting the IdP on
 * every request.
 */

import { createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { SonanceSsoConfig } from "../config/types.gateway.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/sonance-sso");

export type SonanceUserIdentity = {
  userId: string;
  email?: string;
  role?: string;
  /** Raw decoded JWT payload for downstream consumers. */
  claims: Record<string, unknown>;
};

type JwtHeader = { alg: string; typ?: string; kid?: string };

type JwksKey = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
};

type JwksResponse = { keys: JwksKey[] };

// ---------------------------------------------------------------------------
// JWKS Cache
// ---------------------------------------------------------------------------

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const JWKS_FETCH_TIMEOUT_MS = 5_000;

type JwksCacheEntry = {
  keys: JwksKey[];
  fetchedAt: number;
};

const jwksCache = new Map<string, JwksCacheEntry>();

async function fetchJwks(uri: string): Promise<JwksKey[]> {
  const cached = jwksCache.get(uri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(uri, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as JwksResponse;
    if (!body.keys || !Array.isArray(body.keys)) {
      throw new Error("JWKS response missing 'keys' array");
    }

    jwksCache.set(uri, { keys: body.keys, fetchedAt: Date.now() });
    return body.keys;
  } finally {
    clearTimeout(timeout);
  }
}

function findJwksKey(keys: JwksKey[], header: JwtHeader): JwksKey | undefined {
  const candidates = keys.filter(
    (k) => (!k.use || k.use === "sig") && (!k.alg || k.alg === header.alg),
  );
  if (header.kid) {
    return candidates.find((k) => k.kid === header.kid);
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function decodeJwtPayload(token: string): {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signatureInput: string;
  signature: string;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("malformed JWT: expected 3 parts");
  }
  const header = JSON.parse(base64UrlDecode(parts[0]).toString("utf-8")) as JwtHeader;
  const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf-8")) as Record<
    string,
    unknown
  >;
  return {
    header,
    payload,
    signatureInput: `${parts[0]}.${parts[1]}`,
    signature: parts[2],
  };
}

function verifyHs256(signatureInput: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(signatureInput).digest();
  const actual = base64UrlDecode(signature);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

function jwkToKeyObject(jwk: JwksKey) {
  return createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
}

function verifyRsaOrEc(
  signatureInput: string,
  signature: string,
  jwk: JwksKey,
  alg: string,
): boolean {
  const algMap: Record<string, string> = {
    RS256: "RSA-SHA256",
    RS384: "RSA-SHA384",
    RS512: "RSA-SHA512",
    ES256: "SHA256",
    ES384: "SHA384",
    ES512: "SHA512",
  };

  const nodeAlg = algMap[alg];
  if (!nodeAlg) {
    return false;
  }

  const key = jwkToKeyObject(jwk);
  const verifier = createVerify(nodeAlg);
  verifier.update(signatureInput);
  verifier.end();

  const sigBuf = base64UrlDecode(signature);

  // EC signatures in JWTs use raw R||S format; Node's verify expects DER.
  if (alg.startsWith("ES")) {
    const derSig = rawEcToDer(sigBuf, alg);
    return verifier.verify(key, derSig);
  }

  return verifier.verify(key, sigBuf);
}

/**
 * Convert raw R||S EC signature (as used in JWS) to ASN.1 DER format
 * that Node.js crypto expects.
 */
function rawEcToDer(raw: Buffer, alg: string): Buffer {
  const componentLengths: Record<string, number> = {
    ES256: 32,
    ES384: 48,
    ES512: 66,
  };
  const len = componentLengths[alg] ?? raw.length / 2;
  const r = raw.subarray(0, len);
  const s = raw.subarray(len);

  const encodeInt = (buf: Buffer): Buffer => {
    let start = 0;
    while (start < buf.length - 1 && buf[start] === 0) {
      start++;
    }
    const trimmed = buf.subarray(start);
    const needsPad = trimmed[0] >= 0x80;
    const intBytes = needsPad ? Buffer.concat([Buffer.from([0x00]), trimmed]) : trimmed;
    return Buffer.concat([Buffer.from([0x02, intBytes.length]), intBytes]);
  };

  const rDer = encodeInt(r);
  const sDer = encodeInt(s);
  const seqLen = rDer.length + sDer.length;
  return Buffer.concat([Buffer.from([0x30, seqLen]), rDer, sDer]);
}

// ---------------------------------------------------------------------------
// Claim helpers
// ---------------------------------------------------------------------------

function resolveClaim(payload: Record<string, unknown>, claimPath: string): string | undefined {
  const value = payload[claimPath];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Token validation (async — supports JWKS fetch)
// ---------------------------------------------------------------------------

/**
 * When `entraIdTenantId` is set but `jwksUri`/`issuer` are not, derive them
 * from the tenant so operators only need to provide a single value.
 */
function resolveEntraIdDefaults(config: SonanceSsoConfig): SonanceSsoConfig {
  const tenant = config.entraIdTenantId?.trim();
  if (!tenant) {
    return config;
  }

  return {
    ...config,
    jwksUri:
      config.jwksUri ?? "https://login.microsoftonline.com/" + tenant + "/discovery/v2.0/keys",
    issuer: config.issuer ?? "https://login.microsoftonline.com/" + tenant + "/v2.0",
    // Entra ID tokens use "preferred_username" for email and "oid" for user id
    userIdClaim: config.userIdClaim ?? "oid",
    emailClaim: config.emailClaim ?? "preferred_username",
  };
}

export async function validateSonanceSsoToken(
  token: string,
  rawConfig: SonanceSsoConfig,
): Promise<SonanceUserIdentity | { error: string }> {
  const config = resolveEntraIdDefaults(rawConfig);

  let header: JwtHeader;
  let payload: Record<string, unknown>;
  let signatureInput: string;
  let signature: string;

  try {
    ({ header, payload, signatureInput, signature } = decodeJwtPayload(token));
  } catch (err) {
    return { error: `JWT decode failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // --- Signature verification ---

  if (config.jwtSecret) {
    if (header.alg !== "HS256") {
      return {
        error: "unsupported JWT alg '" + header.alg + "' (expected HS256 for jwtSecret mode)",
      };
    }
    if (!verifyHs256(signatureInput, signature, config.jwtSecret)) {
      return { error: "JWT signature verification failed" };
    }
  } else if (config.jwksUri) {
    const supportedAlgs = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"];
    if (!supportedAlgs.includes(header.alg)) {
      return { error: "unsupported JWT alg '" + header.alg + "' for JWKS verification" };
    }

    let keys: JwksKey[];
    try {
      keys = await fetchJwks(config.jwksUri);
    } catch (err) {
      log.warn("JWKS fetch error", { err: String(err), uri: config.jwksUri });
      return { error: `JWKS fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    const jwk = findJwksKey(keys, header);
    if (!jwk) {
      // Key not found — could be a rotation. Bust cache and retry once.
      jwksCache.delete(config.jwksUri);
      try {
        keys = await fetchJwks(config.jwksUri);
      } catch (err) {
        return {
          error: `JWKS re-fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const retryJwk = findJwksKey(keys, header);
      if (!retryJwk) {
        const kid = header.kid ?? "(none)";
        return { error: "no matching JWKS key for kid=" + kid + " alg=" + header.alg };
      }
      if (!verifyRsaOrEc(signatureInput, signature, retryJwk, header.alg)) {
        return { error: "JWT signature verification failed (JWKS)" };
      }
    } else {
      if (!verifyRsaOrEc(signatureInput, signature, jwk, header.alg)) {
        return { error: "JWT signature verification failed (JWKS)" };
      }
    }
  } else {
    return {
      error:
        "sonance-sso: no verification method configured (set gateway.auth.sonanceSso.jwtSecret or .jwksUri)",
    };
  }

  // --- Claim validation ---

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  if (exp !== undefined && exp < now) {
    return { error: "JWT expired" };
  }

  const nbf = typeof payload.nbf === "number" ? payload.nbf : undefined;
  if (nbf !== undefined && nbf > now + 60) {
    return { error: "JWT not yet valid (nbf)" };
  }

  if (config.issuer) {
    const iss = typeof payload.iss === "string" ? payload.iss : undefined;
    if (iss !== config.issuer) {
      return {
        error:
          "JWT issuer mismatch: expected '" + config.issuer + "', got '" + (iss ?? "(none)") + "'",
      };
    }
  }

  if (config.audience) {
    const aud = payload.aud;
    const audList = Array.isArray(aud)
      ? aud.filter((a): a is string => typeof a === "string")
      : typeof aud === "string"
        ? [aud]
        : [];
    if (!audList.includes(config.audience)) {
      return { error: "JWT audience mismatch: expected '" + config.audience + "'" };
    }
  }

  // --- Identity extraction ---

  const userIdClaim = config.userIdClaim ?? "sub";
  const userId = resolveClaim(payload, userIdClaim);
  if (!userId) {
    return { error: "JWT missing required claim '" + userIdClaim + "'" };
  }

  const emailClaim = config.emailClaim ?? "email";
  const roleClaim = config.roleClaim ?? "role";

  return {
    userId,
    email: resolveClaim(payload, emailClaim),
    role: resolveClaim(payload, roleClaim),
    claims: payload,
  };
}

/**
 * Clear the JWKS cache — primarily for testing.
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}

/**
 * Extract and validate a Sonance SSO token from an HTTP request.
 * Returns the user identity or an error string.
 */
export async function authorizeSonanceSso(params: {
  req?: IncomingMessage;
  config: SonanceSsoConfig;
  trustedProxies?: string[];
}): Promise<SonanceUserIdentity | { error: string }> {
  const { req, config } = params;
  if (!req) {
    return { error: "sonance-sso: no request" };
  }

  const headerName = (config.tokenHeader ?? "x-sonance-token").toLowerCase();
  const raw = req.headers[headerName];
  const token = Array.isArray(raw) ? raw[0] : raw;

  if (!token || !token.trim()) {
    return { error: "sonance-sso: missing token header '" + headerName + "'" };
  }

  return validateSonanceSsoToken(token.trim(), config);
}
