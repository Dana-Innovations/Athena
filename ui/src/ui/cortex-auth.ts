/**
 * Cortex user authentication for the Control UI.
 *
 * AI Intranet redirect-based SSO flow:
 *   1. Redirect to aiintranet.sonance.com/login?returnTo=<app_url>&app=<app_id>
 *   2. AI Intranet handles Auth0 → Okta SSO
 *   3. AI Intranet redirects back with ?auth_token=<single_use_token>
 *   4. Validate token via GET /api/auth/central-check?application=APP_ID&auth_token=TOKEN
 *   5. Store user session in localStorage — gateway validates via central-check (Mode B)
 */

const STORAGE_KEY = "openclaw.cortex.auth.v1";

/** Session duration — 24 hours (AI Intranet sessions last ~24h). */
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

/** Expiry safety buffer — treat sessions as expired 5 minutes early. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export type CortexAuthSession = {
  jwt: string;
  userId: string;
  email: string;
  displayName?: string;
  role?: string;
  /** Unix timestamp (ms) when the session expires. */
  expiresAt: number;
};

type StoredAuth = {
  version: 1;
  session: CortexAuthSession;
};

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

export function loadCortexAuth(): CortexAuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredAuth;
    if (parsed.version !== 1 || !parsed.session?.jwt) {
      return null;
    }
    if (parsed.session.expiresAt < Date.now() + EXPIRY_BUFFER_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.session;
  } catch {
    return null;
  }
}

export function storeCortexAuth(session: CortexAuthSession): void {
  const stored: StoredAuth = { version: 1, session };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearCortexAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// SSO flow — Step 1: Initiate (redirect to AI Intranet login)
// ---------------------------------------------------------------------------

/**
 * Start the Okta SSO flow via AI Intranet redirect.
 * This redirects the browser to the AI Intranet login page which handles
 * Auth0 → Okta SSO. After authentication, the AI Intranet redirects back
 * with ?auth_token=... which is handled by `completeSsoCallback`.
 */
export async function startCortexOktaSso(opts: {
  aiIntranetUrl: string;
  appId: string;
}): Promise<void> {
  const { aiIntranetUrl, appId } = opts;
  const baseUrl = aiIntranetUrl.replace(/\/+$/, "");

  // Build the returnTo URL — current page origin + path (without query params).
  const returnTo = window.location.origin + window.location.pathname;

  // Redirect to AI Intranet login with returnTo and app parameters.
  const loginUrl = new URL(`${baseUrl}/login`);
  loginUrl.searchParams.set("returnTo", returnTo);
  loginUrl.searchParams.set("app", appId);

  window.location.href = loginUrl.toString();
}

// ---------------------------------------------------------------------------
// SSO flow — Step 2: Complete callback (after redirect back from AI Intranet)
// ---------------------------------------------------------------------------

type CentralCheckResponse = {
  access: boolean;
  user?: {
    email?: string;
    name?: string;
    id?: string;
  };
  error?: string;
};

/**
 * Complete the SSO flow after AI Intranet redirects back with ?auth_token=...
 * Validates the single-use token via the central-check endpoint and stores
 * the user session. The gateway validates using Mode B (api_key + user_email).
 */
export async function completeSsoCallback(opts: {
  aiIntranetUrl: string;
  appId: string;
  authToken: string;
  onStatus?: (status: string) => void;
}): Promise<CortexAuthSession> {
  const { aiIntranetUrl, appId, authToken, onStatus } = opts;
  const baseUrl = aiIntranetUrl.replace(/\/+$/, "");

  // Validate the auth_token via central-check (Mode A: auth_token).
  onStatus?.("Validating authentication\u2026");
  const checkUrl = new URL(`${baseUrl}/api/auth/central-check`);
  checkUrl.searchParams.set("application", appId);
  checkUrl.searchParams.set("auth_token", authToken);

  const res = await fetch(checkUrl.toString());
  if (!res.ok) {
    throw new Error(`Authentication validation failed (${res.status})`);
  }

  const data = (await res.json()) as CentralCheckResponse;
  if (!data.access) {
    throw new Error(
      data.error || "Access denied — you may not have permission to use this application",
    );
  }

  const email = data.user?.email ?? "";
  const session: CortexAuthSession = {
    // Store the email as the "jwt" field — the gateway uses this for Mode B validation.
    jwt: email,
    userId: data.user?.id ?? email,
    email,
    displayName: data.user?.name ?? undefined,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  storeCortexAuth(session);

  // Clean up the URL (remove ?auth_token=... from address bar).
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState(null, "", cleanUrl);

  return session;
}

/**
 * Check if the current URL contains an SSO callback auth_token.
 */
export function getSsoCallbackCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("auth_token");
}
