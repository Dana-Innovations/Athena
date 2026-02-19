/**
 * OAuth 2.0 Authorization Code + PKCE flow for Microsoft Entra ID.
 *
 * Opens a browser to the Entra ID authorize endpoint, listens for the
 * callback on a local HTTP server, exchanges the code for tokens, and
 * returns the full token set.
 *
 * The same token set provides:
 *   - id_token  → used for OpenClaw gateway sonance-sso authentication
 *   - access_token → passed to the M365 MCP for Graph API access
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type SonanceOAuthConfig = {
  tenantId: string;
  /** Entra ID app (client) registration ID. */
  clientId: string;
  /**
   * OAuth scopes.  Always includes "openid profile email offline_access".
   * Add Graph scopes here for M365 data access (e.g. "Calendars.Read Mail.Read").
   */
  scopes?: string[];
  /** Local port for the OAuth redirect. @default 18790 */
  redirectPort?: number;
};

export type SonanceOAuthResult = {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
};

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/**
 * Runs the full OAuth PKCE flow:
 *  1. Generates PKCE code_verifier + code_challenge
 *  2. Starts a local HTTP server on redirectPort
 *  3. Opens the browser to Entra ID /authorize
 *  4. Waits for the callback with the auth code
 *  5. Exchanges the code for tokens at /token
 *  6. Returns the token set
 */
export async function runSonanceOAuthFlow(
  config: SonanceOAuthConfig,
  openBrowser: (url: string) => void,
  log: (msg: string) => void,
): Promise<SonanceOAuthResult> {
  const port = config.redirectPort ?? 18790;
  const redirectUri = "http://localhost:" + port + "/callback";
  const baseScopes = ["openid", "profile", "email", "offline_access"];
  const extraScopes = config.scopes ?? [];
  const allScopes = [...new Set([...baseScopes, ...extraScopes])];
  const scopeString = allScopes.join(" ");

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = base64url(randomBytes(16));

  const authorizeUrl =
    "https://login.microsoftonline.com/" +
    encodeURIComponent(config.tenantId) +
    "/oauth2/v2.0/authorize?" +
    new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: scopeString,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();

  return new Promise<SonanceOAuthResult>((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      server.close();
      reject(new Error("OAuth flow timed out after 5 minutes"));
    }, 5 * 60_000);

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (settled) {
        res.writeHead(400);
        res.end("Session already completed.");
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost:" + port);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        settled = true;
        clearTimeout(timeout);
        server.close();
        const desc = url.searchParams.get("error_description") ?? error;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(desc));
        reject(new Error("OAuth error: " + desc));
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorHtml("Missing authorization code."));
        return;
      }

      if (returnedState !== state) {
        settled = true;
        clearTimeout(timeout);
        server.close();
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorHtml("State mismatch — possible CSRF."));
        reject(new Error("OAuth state mismatch"));
        return;
      }

      try {
        const tokenResult = await exchangeCode({
          tenantId: config.tenantId,
          clientId: config.clientId,
          code,
          redirectUri,
          codeVerifier,
          scope: scopeString,
        });

        settled = true;
        clearTimeout(timeout);
        server.close();
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(successHtml());
        resolve(tokenResult);
      } catch (err) {
        settled = true;
        clearTimeout(timeout);
        server.close();
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml("Token exchange failed: " + msg));
        reject(err instanceof Error ? err : new Error(msg));
      }
    });

    server.listen(port, "127.0.0.1", () => {
      log("Opening browser for Sonance SSO sign-in...");
      log("If the browser doesn't open, visit:");
      log(authorizeUrl);
      openBrowser(authorizeUrl);
    });

    server.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new Error("Failed to start OAuth callback server: " + err.message));
    });
  });
}

async function exchangeCode(params: {
  tenantId: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  scope: string;
}): Promise<SonanceOAuthResult> {
  const tokenUrl =
    "https://login.microsoftonline.com/" +
    encodeURIComponent(params.tenantId) +
    "/oauth2/v2.0/token";

  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    scope: params.scope,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("Token exchange failed (" + res.status + "): " + text);
  }

  const json = (await res.json()) as Record<string, unknown>;

  const idToken = json.id_token;
  const accessToken = json.access_token;
  if (typeof idToken !== "string" || typeof accessToken !== "string") {
    throw new Error("Token response missing id_token or access_token");
  }

  return {
    idToken,
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
  };
}

/**
 * Refresh an access_token using a stored refresh_token.
 */
export async function refreshSonanceTokens(params: {
  tenantId: string;
  clientId: string;
  refreshToken: string;
  scopes?: string[];
}): Promise<SonanceOAuthResult> {
  const tokenUrl =
    "https://login.microsoftonline.com/" +
    encodeURIComponent(params.tenantId) +
    "/oauth2/v2.0/token";

  const scopeString = params.scopes?.join(" ") ?? "openid profile email offline_access";

  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    scope: scopeString,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("Token refresh failed (" + res.status + "): " + text);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const idToken = json.id_token;
  const accessToken = json.access_token;
  if (typeof idToken !== "string" || typeof accessToken !== "string") {
    throw new Error("Refresh response missing id_token or access_token");
  }

  return {
    idToken,
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
  };
}

function successHtml(): string {
  return [
    "<!DOCTYPE html><html><head><title>Sonance SSO</title>",
    "<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;",
    "min-height:100vh;margin:0;background:#f0f4f8}",
    ".card{background:#fff;border-radius:12px;padding:48px;box-shadow:0 2px 12px rgba(0,0,0,.08);",
    "text-align:center;max-width:420px}",
    "h1{color:#059669;margin:0 0 12px}p{color:#475569;margin:0}</style></head>",
    '<body><div class="card">',
    "<h1>Signed in</h1>",
    "<p>You can close this tab and return to your terminal.</p>",
    "</div></body></html>",
  ].join("");
}

function errorHtml(message: string): string {
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!DOCTYPE html><html><head><title>Sonance SSO Error</title>",
    "<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;",
    "min-height:100vh;margin:0;background:#fef2f2}",
    ".card{background:#fff;border-radius:12px;padding:48px;box-shadow:0 2px 12px rgba(0,0,0,.08);",
    "text-align:center;max-width:420px}",
    "h1{color:#dc2626;margin:0 0 12px}p{color:#475569;margin:0}</style></head>",
    '<body><div class="card">',
    "<h1>Sign-in failed</h1>",
    "<p>" + escaped + "</p>",
    "</div></body></html>",
  ].join("");
}
