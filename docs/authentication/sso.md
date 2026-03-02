---
summary: "Okta SSO authentication via AI Intranet redirect for the Control UI"
read_when:
  - Debugging SSO login issues or auth failures
  - Configuring Okta authentication for a new deployment
  - Working on gateway auth, Control UI login, or cortex-auth code
  - Understanding the AI Intranet central-check validation pattern
title: "SSO Authentication"
---

# SSO Authentication

Last updated: 2026-02-21

## Overview

Athena uses **Okta SSO** for authenticating Control UI users. The gateway runs in
`cortex` auth mode, which gates the UI behind a login screen and validates every
WebSocket connection.

The SSO implementation uses the **AI Intranet redirect pattern** — the same
approach used by Process Documentation and other internal Sonance applications.
Instead of talking to Okta or Supabase SAML directly, the Control UI redirects
to the AI Intranet (`aiintranet.sonance.com`), which handles the full
Auth0 → Okta SAML flow. After authentication, the AI Intranet redirects back
with a single-use `auth_token` that is validated via its `central-check` API.

### Why this pattern?

The Okta SAML app ("AI Intranet V2") has its ACS (Assertion Consumer Service)
URL pointing to the AI Intranet's Auth0 tenant, not to Supabase's SAML endpoint
or any app-specific callback. This means:

- Direct Supabase SAML SSO cannot work (the SAML response never arrives).
- Direct Okta OIDC would require a separate Okta app registration.
- The AI Intranet redirect pattern works immediately with zero Okta configuration
  because it reuses the existing AI Intranet SSO infrastructure.

---

## Auth flow

### Step-by-step

1. User opens the Control UI (e.g. `http://127.0.0.1:18789/`).
2. The UI fetches `/__openclaw/control-ui-config.json` (bootstrap config).
3. Bootstrap config includes `authMode: "cortex"`, `aiIntranetUrl`, and `appId`.
4. Since `authMode` is `"cortex"` and no stored session exists, the UI renders
   the login screen.
5. User clicks **"Sign in with Okta"**.
6. `startCortexOktaSso()` builds the redirect URL and navigates the browser to
   `https://aiintranet.sonance.com/login?returnTo=<app_url>&app=<app_id>`.
7. AI Intranet handles the Auth0 → Okta SAML exchange.
8. User authenticates in Okta.
9. AI Intranet generates a single-use `auth_token` and redirects back to
   `http://127.0.0.1:18789/?auth_token=TOKEN`.
10. The UI detects `?auth_token=` in the URL on page load.
11. `completeSsoCallback()` validates the token via
    `GET /api/auth/central-check?application=APP_ID&auth_token=TOKEN` (Mode A).
12. On success, the user's email/name are stored as a `CortexAuthSession` in
    localStorage with a 24-hour expiry. The email is stored in the `jwt` field.
13. The UI cleans the URL (removes `?auth_token=...` from the address bar).
14. `connectGateway()` opens a WebSocket to the gateway, sending the user's
    email as `connectAuth.token`.
15. The gateway receives the connection and validates via
    `GET /api/auth/central-check?application=APP_ID&api_key=APP_API_KEY&user_email=EMAIL`
    (Mode B — server-to-server).
16. If `access: true`, the connection is authenticated. The user identity is
    stored in the gateway's session context for audit and billing.

### Flow diagram

```
Browser (Control UI)              AI Intranet                  Gateway
────────────────────              ───────────                  ───────

1. Load bootstrap config  ──────────────────────────────────→  Serve JSON
   (authMode, aiIntranetUrl, appId)                            (no secrets)

2. Show login screen

3. Click "Sign in"
   ↓
4. Redirect ──────────→  /login?returnTo=...&app=...
                          ↓
5.                        Auth0 → Okta SAML
                          ↓
6.                        Generate auth_token
   ←────────────────────  Redirect ?auth_token=TOKEN

7. Validate token
   GET central-check  ──→  Validate auth_token (Mode A)
   ←─────────────────────  { access: true, user: {...} }

8. Store session
   (localStorage)

9. Connect WebSocket  ───────────────────────────────────→  Receive connect
   (email in token)                                         ↓
                                                       10. Validate email
                                                           GET central-check
                                                           (Mode B: api_key
                                                           + user_email)
                                                           ↓
                          ←──────────────────────────────  11. Authenticated
```

---

## Environment variables

| Variable                  | Required | Description                                                                                                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_INTRANET_URL`         | Yes      | AI Intranet base URL (e.g. `https://aiintranet.sonance.com`). Used for SSO redirect and central-check API calls.                                     |
| `AI_INTRANET_APP_ID`      | Yes      | Application UUID from the AI Intranet `applications` table. Identifies Athena in central-check requests.                                             |
| `AI_INTRANET_APP_API_KEY` | Yes      | Application API key from the AI Intranet `applications` table. Used by the gateway for server-side Mode B validation. **Never sent to the browser.** |
| `SONANCE_CORTEX_API_URL`  | No       | Cortex API base URL. Provides the `cortexUrl` for the gateway config. Only needed if using JWT fallback validation.                                  |

### Example `.env`

```bash
# SSO authentication (AI Intranet redirect-based SSO via Okta)
AI_INTRANET_URL=https://aiintranet.sonance.com
AI_INTRANET_APP_ID=1b9007a0-dfd2-473b-9e94-96b397d50b02
AI_INTRANET_APP_API_KEY=a8cce88b-3197-4792-ac26-2022d4b0bcd7
```

### Env resolution order (highest wins)

1. Process environment
2. `./.env` (repository root)
3. `~/.openclaw/.env` (user home)
4. `openclaw.json` `env` block

The `applySonanceDefaults()` function in `src/config/sonance-defaults.ts` reads
these env vars and merges them into the gateway config when the auth mode is
`"cortex"`.

---

## Server-side architecture

### Config type — `CortexAuthConfig`

Defined in `src/config/types.gateway.ts` (lines 139–178).

```typescript
type CortexAuthConfig = {
  cortexUrl: string; // Cortex API base URL (for JWKS fallback)
  aiIntranetUrl?: string; // AI Intranet redirect URL
  appId?: string; // App ID for central-check
  appApiKey?: string; // App API key for Mode B (server-only)
  supabaseUrl?: string; // Supabase project URL (legacy)
  supabaseAnonKey?: string; // Supabase anon key (legacy)
  ssoDomain?: string; // SSO email domain
  jwksUri?: string; // JWKS endpoint for JWT fallback
  jwtSecret?: string; // HS256 secret for JWT fallback
  issuer?: string; // Expected JWT issuer
  audience?: string; // Expected JWT audience
  userIdClaim?: string; // JWT claim for user ID (default: "sub")
  emailClaim?: string; // JWT claim for email (default: "email")
  roleClaim?: string; // JWT claim for role (default: "role")
};
```

### Config defaults — `applySonanceDefaults()`

Defined in `src/config/sonance-defaults.ts`.

When `gateway.auth.mode === "cortex"`:

- Reads `AI_INTRANET_URL` → `cortex.aiIntranetUrl`
- Reads `AI_INTRANET_APP_ID` → `cortex.appId`
- Reads `AI_INTRANET_APP_API_KEY` → `cortex.appApiKey`
- Reads `SONANCE_CORTEX_API_URL` → `cortex.cortexUrl`

Explicit values in `openclaw.json` take precedence over env vars.

### Bootstrap config — `handleControlUiHttpRequest()`

Defined in `src/gateway/control-ui.ts`.

Serves `/__openclaw/control-ui-config.json` with:

```json
{
  "basePath": "",
  "assistantName": "Athena",
  "assistantAvatar": "...",
  "assistantAgentId": "...",
  "authMode": "cortex",
  "cortexUrl": "http://localhost:8000",
  "aiIntranetUrl": "https://aiintranet.sonance.com",
  "appId": "1b9007a0-dfd2-473b-9e94-96b397d50b02"
}
```

The `appApiKey` is intentionally excluded — it is server-side only.

The contract type `ControlUiBootstrapConfig` is defined in
`src/gateway/control-ui-contract.ts`.

### CSP header — `buildControlUiCspHeader()`

Defined in `src/gateway/control-ui-csp.ts`.

The `connect-src` directive allows:

- `'self'` — same-origin requests
- `ws: wss:` — WebSocket connections
- `cortexUrl` origin — Cortex API
- `supabaseUrl` origin — Supabase (file sync)
- `aiIntranetUrl` origin — AI Intranet central-check API

Other security headers applied to all Control UI responses:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

### Gateway auth validation — `authorizeGatewayConnect()`

Defined in `src/gateway/auth.ts`.

When auth mode is `"cortex"`, the gateway validates incoming WebSocket
connections in two possible paths:

**Path 1 — AI Intranet central-check (Mode B)**

Used when `aiIntranetUrl`, `appId`, and `appApiKey` are all configured.

1. Extract `userEmail` from `connectAuth.token` (sent by the UI).
2. Call `GET {aiIntranetUrl}/api/auth/central-check` with query params:
   - `application` = `appId`
   - `api_key` = `appApiKey`
   - `user_email` = `userEmail`
3. Parse response JSON: `{ access: boolean, user?: { email, name } }`.
4. If `access === true`, return authenticated with user identity.
5. Otherwise, reject with `cortex_central_check_denied`.

**Path 2 — JWT validation (fallback)**

Used when AI Intranet config is incomplete. Falls back to Sonance SSO JWT
validation:

1. Extract JWT from `connectAuth.token`.
2. Build `SonanceSsoConfig` from cortex config fields.
3. Validate signature via JWKS or HS256 secret.
4. Extract user claims and return identity.

### Startup validation

In `src/gateway/auth.ts`, the `validateGatewayAuthConfig()` function requires
that cortex mode has either `cortexUrl` or `aiIntranetUrl` configured. If
neither is present, the gateway refuses to start.

### Session context — `sonance-context.ts`

After successful authentication, the user identity (`SonanceUserIdentity`) is
stored in an in-memory map keyed by session ID. This is used by the audit logger
and the Cortex plugin for billing attribution. Entries expire after 24 hours.

---

## Client-side architecture

### Bootstrap loading

`ui/src/ui/controllers/control-ui-bootstrap.ts` — `loadControlUiBootstrapConfig()`

On page load, fetches `/__openclaw/control-ui-config.json` and populates the
app state with `authMode`, `cortexUrl`, `aiIntranetUrl`, `appId`,
`supabaseUrl`, `supabaseAnonKey`, `ssoDomain`.

### UI state fields

Declared in `ui/src/ui/app.ts` (Lit `@state()` decorators) and typed in
`ui/src/ui/app-view-state.ts`:

| Field                | Type                        | Description                                   |
| -------------------- | --------------------------- | --------------------------------------------- |
| `authMode`           | `string`                    | Gateway auth mode from bootstrap (`"cortex"`) |
| `aiIntranetUrl`      | `string \| null`            | AI Intranet redirect URL                      |
| `appId`              | `string \| null`            | Application ID for central-check              |
| `cortexUser`         | `CortexAuthSession \| null` | Current authenticated session                 |
| `cortexLoginLoading` | `boolean`                   | Whether SSO is in progress                    |
| `cortexLoginError`   | `string \| null`            | Error from SSO flow                           |
| `cortexLoginStatus`  | `string \| null`            | Status message (e.g. "Validating...")         |

### SSO initiation — `startCortexOktaSso()`

`ui/src/ui/cortex-auth.ts`

Called by `handleCortexLogin()` in `app.ts` when the user clicks "Sign in with
Okta".

```typescript
function startCortexOktaSso(opts: { aiIntranetUrl: string; appId: string }): Promise<void>;
```

Builds the login URL:

```
https://aiintranet.sonance.com/login?returnTo=http://127.0.0.1:18789/&app=APP_ID
```

Sets `window.location.href` to redirect the browser.

### Callback handling — `handleConnected()`

`ui/src/ui/app-lifecycle.ts`

After the page reloads from the AI Intranet redirect, `handleConnected()` runs
during the Lit component `connectedCallback`. It:

1. Loads bootstrap config.
2. Checks for `?auth_token=` in the URL via `getSsoCallbackCode()`.
3. If found (and `aiIntranetUrl` + `appId` are set), calls
   `completeSsoCallback()`.
4. On success, calls `connectGateway()` to establish the WebSocket.

### Token validation — `completeSsoCallback()`

`ui/src/ui/cortex-auth.ts`

```typescript
function completeSsoCallback(opts: {
  aiIntranetUrl: string;
  appId: string;
  authToken: string;
  onStatus?: (status: string) => void;
}): Promise<CortexAuthSession>;
```

1. Calls `GET {aiIntranetUrl}/api/auth/central-check?application=APP_ID&auth_token=TOKEN`.
2. Checks `response.access === true`.
3. Creates a `CortexAuthSession`:
   - `jwt`: user's email (used as the gateway auth token)
   - `userId`: user's ID or email
   - `email`: user's email
   - `displayName`: user's name
   - `expiresAt`: `Date.now() + 24 hours`
4. Stores in localStorage under `openclaw.cortex.auth.v1`.
5. Cleans the URL (removes `?auth_token=...`).

### Session persistence

`ui/src/ui/cortex-auth.ts`

| Function                   | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| `loadCortexAuth()`         | Read session from localStorage; auto-clear if expired (with 5-min buffer) |
| `storeCortexAuth(session)` | Write session to localStorage                                             |
| `clearCortexAuth()`        | Remove session (called on logout)                                         |

Storage key: `openclaw.cortex.auth.v1`

Session duration: 24 hours. Treated as expired 5 minutes early to avoid
edge-case failures.

### WebSocket auth — `connectGateway()`

`ui/src/ui/app-gateway.ts`

When `authMode === "cortex"` and `cortexUser` exists, the user's email
(`cortexUser.jwt`) is sent as `connectAuth.token` in the WebSocket handshake:

```typescript
const authToken =
  host.authMode === "cortex" && host.cortexUser?.jwt
    ? host.cortexUser.jwt // User's email address
    : host.settings.token.trim()
      ? host.settings.token // Token auth fallback
      : undefined;

new GatewayBrowserClient({
  token: authToken,
  // ...
});
```

The gateway receives this in `authorizeGatewayConnect()` as `connectAuth.token`.

### Login screen — `cortex-login.ts`

`ui/src/ui/views/cortex-login.ts`

Rendered when `authMode === "cortex"` and `cortexUser === null`. Displays:

- Animated Cortex orb background (glass-morphism)
- "Athena" title
- **"Sign in with Okta"** button → calls `state.handleCortexLogin()`
- Status message during validation
- Error display on failure

### Logout — `handleCortexLogout()`

`ui/src/ui/app.ts`

Calls `clearCortexAuth()`, resets `cortexUser` to null, stops the WebSocket
client, and sets `connected` to false. The login screen reappears.

---

## Security model

### Browser vs server boundary

| Data               | Browser                    | Gateway                      |
| ------------------ | -------------------------- | ---------------------------- |
| `aiIntranetUrl`    | Yes (bootstrap)            | Yes (config)                 |
| `appId`            | Yes (bootstrap)            | Yes (config)                 |
| `appApiKey`        | **Never**                  | Yes (config)                 |
| `auth_token`       | Yes (URL param, transient) | No                           |
| User email         | Yes (localStorage)         | Yes (central-check response) |
| JWT secrets / JWKS | **Never**                  | Yes (config, for fallback)   |

### Dual validation

Authentication is validated **twice**:

1. **Mode A (browser-side)**: The UI validates the `auth_token` from the AI
   Intranet redirect by calling central-check. This is a single-use token that
   proves the user just completed Okta SSO. The result gives us the user's
   email and name.

2. **Mode B (server-side)**: When the UI connects to the gateway WebSocket, the
   gateway independently re-validates the user's email via central-check using
   the `appApiKey`. This ensures a compromised browser can't forge a session.

### CSP protections

The Content-Security-Policy header restricts what the browser can access:

- Scripts: `'self'` only (no inline, no external)
- Styles: `'self' 'unsafe-inline'` (UI uses inline styles)
- Connections: `'self'`, WebSocket, and whitelisted auth origins
- Framing: `DENY` (cannot be iframed)
- Images: `'self' data: https:` (avatars and logos)

### Session expiry

Sessions expire after 24 hours. A 5-minute safety buffer means sessions are
treated as expired slightly early to avoid race conditions where a request is
made with a token that expires mid-flight.

On expiry, `loadCortexAuth()` automatically clears localStorage and returns
null, causing the login screen to reappear.

---

## AI Intranet central-check API

The AI Intranet exposes a REST endpoint for validating authentication:

```
GET {AI_INTRANET_URL}/api/auth/central-check
```

### Mode A — Single-use auth_token (browser validation)

Used by the Control UI after the SSO redirect.

```
GET /api/auth/central-check?application=APP_ID&auth_token=TOKEN
```

- `application`: The app's UUID from the `applications` table.
- `auth_token`: The single-use token from the redirect URL.

Response:

```json
{
  "access": true,
  "user": {
    "email": "user@sonance.com",
    "name": "User Name",
    "id": "user-uuid"
  }
}
```

The `auth_token` is consumed on first use and cannot be replayed.

### Mode B — API key + user email (server validation)

Used by the gateway for WebSocket connection validation.

```
GET /api/auth/central-check?application=APP_ID&api_key=APP_API_KEY&user_email=EMAIL
```

- `application`: The app's UUID.
- `api_key`: The app's API key (server-side secret).
- `user_email`: The email address to check access for.

Response:

```json
{
  "access": true,
  "user": {
    "email": "user@sonance.com",
    "name": "User Name"
  }
}
```

### Prerequisites

For central-check to work, the following must be configured in the AI Intranet
database:

1. **`applications` table**: Athena must be registered with `use_central_auth: true`.
2. **`trusted_domains` table**: Must include the Control UI's host
   (e.g. `127.0.0.1`, `localhost`). This controls which `returnTo` URLs the AI
   Intranet will redirect back to after SSO.

---

## All gateway auth modes

The gateway supports 6 authentication modes. Cortex mode is the default for
Sonance deployments.

| Mode            | Config key                           | Description                                                                                                                                            |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`          | `gateway.auth.mode: "none"`          | No authentication. Any client can connect.                                                                                                             |
| `token`         | `gateway.auth.mode: "token"`         | Shared secret token (default for non-Sonance). Clients send token in connect handshake.                                                                |
| `password`      | `gateway.auth.mode: "password"`      | Shared password. Clients send password in connect handshake.                                                                                           |
| `trusted-proxy` | `gateway.auth.mode: "trusted-proxy"` | Reverse proxy handles auth. Gateway reads user identity from HTTP headers (e.g. `x-forwarded-user`).                                                   |
| `sonance-sso`   | `gateway.auth.mode: "sonance-sso"`   | JWT-based SSO via HTTP header. The reverse proxy sets a signed JWT header; gateway validates signature via JWKS or HS256.                              |
| `cortex`        | `gateway.auth.mode: "cortex"`        | **Primary Sonance mode.** Control UI handles SSO login, sends auth token in WebSocket connect. Gateway validates via AI Intranet central-check or JWT. |

The auth mode is set in `openclaw.json` at `gateway.auth.mode`. For Sonance
deployments, `applySonanceDefaults()` defaults it to `"cortex"`.

---

## Troubleshooting

### Common failures

| Symptom                                                           | Likely cause                                      | Fix                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Login button shows "SSO not configured"                           | `aiIntranetUrl` or `appId` missing from bootstrap | Check `AI_INTRANET_URL` and `AI_INTRANET_APP_ID` env vars          |
| Browser redirects to AI Intranet portal instead of back to Athena | `returnTo` domain not in `trusted_domains`        | Verify `trusted_domains` table includes the Control UI host        |
| "Access denied" after Okta login                                  | User not authorized for the application           | Check AI Intranet app permissions for the user's email             |
| "Authentication validation failed (4xx)"                          | Invalid `auth_token` or wrong `appId`             | Verify `AI_INTRANET_APP_ID` matches the correct application        |
| WebSocket connects then immediately disconnects                   | Gateway Mode B rejection                          | Check `AI_INTRANET_APP_API_KEY` and gateway logs                   |
| `cortex_central_check_denied` in gateway logs                     | User email not authorized                         | Verify email in AI Intranet application access list                |
| `cortex_central_check_http_500`                                   | AI Intranet server error                          | Check AI Intranet health; try `curl` to central-check endpoint     |
| `cortex_email_missing` in gateway logs                            | UI sent empty `connectAuth.token`                 | Check localStorage for valid session (`openclaw.cortex.auth.v1`)   |
| Session expires immediately                                       | Clock skew or `expiresAt` in the past             | Check system clock; verify `SESSION_DURATION_MS` in cortex-auth.ts |
| CSP errors in browser console                                     | AI Intranet URL not in CSP allowlist              | Verify `aiIntranetUrl` is set in cortex config                     |

### Debug checklist

**Step 1: Verify environment variables**

```bash
# Check that all required vars are set
grep AI_INTRANET .env
# Expected output:
# AI_INTRANET_URL=https://aiintranet.sonance.com
# AI_INTRANET_APP_ID=1b9007a0-...
# AI_INTRANET_APP_API_KEY=a8cce88b-...
```

**Step 2: Check bootstrap config**

```bash
curl -s http://localhost:18789/__openclaw/control-ui-config.json | jq '{authMode, aiIntranetUrl, appId}'
# Verify: authMode is "cortex", aiIntranetUrl and appId are set
```

**Step 3: Test central-check Mode A (browser-side)**

```bash
curl -s "https://aiintranet.sonance.com/api/auth/central-check?application=APP_ID&auth_token=TOKEN"
# Response should include: { "access": true, "user": { "email": "..." } }
# Note: auth_token is single-use, so this only works once per token
```

**Step 4: Test central-check Mode B (server-side)**

```bash
curl -s "https://aiintranet.sonance.com/api/auth/central-check?application=APP_ID&api_key=APP_API_KEY&user_email=user@sonance.com"
# Response should include: { "access": true }
```

**Step 5: Check browser localStorage**

```javascript
// In browser DevTools console:
JSON.parse(localStorage.getItem("openclaw.cortex.auth.v1"));
// Should show: { version: 1, session: { jwt: "user@...", expiresAt: ... } }
```

**Step 6: Check gateway logs**

```bash
# Look for auth-related log entries:
# - "cortex_central_check_denied" — user not authorized
# - "cortex_central_check_http_XXX" — HTTP error from AI Intranet
# - "cortex_central_check_error" — network/parse error
# - "cortex_email_missing" — no email in connect payload
```

### Gateway auth error codes

| Error code                              | Description                                |
| --------------------------------------- | ------------------------------------------ |
| `cortex_config_missing`                 | `gateway.auth.cortex` not configured       |
| `cortex_email_missing`                  | `connectAuth.token` is empty (Mode B path) |
| `cortex_central_check_http_{status}`    | AI Intranet returned non-200 HTTP status   |
| `cortex_central_check_denied`           | AI Intranet returned `access: false`       |
| `cortex_central_check_error: {message}` | Network error calling AI Intranet          |
| `cortex_jwt_missing`                    | JWT missing for fallback validation path   |

---

## File reference

### Server-side

| File                                 | Role                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `src/config/types.gateway.ts`        | `CortexAuthConfig` type, `GatewayAuthMode` enum                        |
| `src/config/sonance-defaults.ts`     | Reads `AI_INTRANET_*` env vars into cortex config                      |
| `src/gateway/auth.ts`                | `authorizeGatewayConnect()` — Mode B central-check + JWT fallback      |
| `src/gateway/control-ui.ts`          | Serves bootstrap config JSON; applies security headers                 |
| `src/gateway/control-ui-contract.ts` | `ControlUiBootstrapConfig` type definition                             |
| `src/gateway/control-ui-csp.ts`      | `buildControlUiCspHeader()` — CSP with AI Intranet origin              |
| `src/gateway/sonance-sso.ts`         | `SonanceUserIdentity` type; `validateSonanceSsoToken()` (JWT fallback) |
| `src/gateway/sonance-context.ts`     | Per-session user identity storage (24h TTL)                            |

### Client-side

| File                                            | Role                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ui/src/ui/cortex-auth.ts`                      | `startCortexOktaSso()`, `completeSsoCallback()`, `getSsoCallbackCode()`, session persistence |
| `ui/src/ui/app-lifecycle.ts`                    | `handleConnected()` — detects `?auth_token=` callback, triggers validation                   |
| `ui/src/ui/app.ts`                              | `handleCortexLogin()`, `handleCortexLogout()`, `@state()` declarations                       |
| `ui/src/ui/app-gateway.ts`                      | `connectGateway()` — sends email as `connectAuth.token`                                      |
| `ui/src/ui/app-view-state.ts`                   | Type definitions for auth-related UI state fields                                            |
| `ui/src/ui/controllers/control-ui-bootstrap.ts` | `loadControlUiBootstrapConfig()` — maps bootstrap to UI state                                |
| `ui/src/ui/views/cortex-login.ts`               | Login screen rendering (Okta button, status, errors)                                         |
