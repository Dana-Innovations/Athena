# Sonance Fork — Change Manifest

This document tracks every file modified or added relative to the upstream
OpenClaw repository. Use it when rebasing onto a new upstream release to
identify potential merge conflicts and verify that all Sonance customizations
survive the merge.

---

## Overview

The fork implements three pillars:

1. **Tool policy lock-down** — a `sonance` tool profile that denies all
   high-risk tools by default and only allows a curated, read-only baseline.
2. **Cortex integration** — a plugin that registers Cortex-managed tools,
   pushes audit events for billing/security, authenticates to Apollo for
   AI model access, and bridges external MCPs (including stdio-based M365 MCP).
3. **Apollo proxy integration** — routes AI model requests through Cortex
   Apollo. Apollo holds the Anthropic key server-side; clients authenticate
   with Cortex credentials (`ctx_...` API key or JWT). Apollo validates,
   enforces rate limits, then proxies to Anthropic. Users never see the
   Anthropic key.
4. **Sonance SSO authentication (future-ready)** — JWT-based gateway auth
   (HS256 + JWKS RS256/ES256) with OAuth PKCE onboarding. Dormant until
   Entra ID app registration is configured; activates when moving to a
   shared/centralized gateway.

**PoC design:** Each employee runs a local gateway with `auth.mode: "none"`.
The M365 MCP handles its own Microsoft OAuth (browser popup on first tool use).

AI model access has two paths:

- **Apollo proxy (recommended):** Set `SONANCE_APOLLO_BASE_URL` + `SONANCE_CORTEX_API_KEY`.
  OpenClaw authenticates to Apollo with the Cortex key; Apollo proxies to
  Anthropic using the server-side `CORTEX_ANTHROPIC_API_KEY`. Gives you rate
  limiting, usage tracking, and cost analytics.
- **Direct fallback:** Set `SONANCE_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`.
  OpenClaw talks directly to `api.anthropic.com`. Simple but no Cortex billing.

**Centralized gateway (future):** Set `entraIdTenantId` + `entraIdClientId`
in config, switch `auth.mode` to `"sonance-sso"`. The `onboard` command will
run OAuth PKCE for unified gateway + M365 auth. All code is already in place.

Supporting changes: channel plugin deny-list, self-service model auth
disabled, per-tool-call audit logging, `logout` CLI command.

---

## Modified Core Files

| File                                                  | Purpose of Change                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/agents/tool-policy.ts`                           | Added `"sonance"` profile ID, `TOOL_GROUPS["group:sonance"]` allowlist, and the `sonance` entry in `TOOL_PROFILES` with an explicit deny list of high-risk tools.                                                                                                              |
| `src/agents/pi-tools.policy.ts`                       | Added `SONANCE_DEFAULT_TOOL_PROFILE` constant; `resolveEffectiveToolPolicy` now defaults to `"sonance"` when no profile is configured.                                                                                                                                         |
| `src/agents/pi-tools.before-tool-call.ts`             | Integrated `emitAuditEvent()` calls into `wrapToolWithBeforeToolCallHook` to log every tool call (blocked, succeeded, or failed) for Sonance audit.                                                                                                                            |
| `src/agents/model-auth.ts`                            | Added `SonanceCentralKeyResolver` type and `setSonanceCentralKeyResolver()` hook; `resolveApiKeyForProvider` now checks the Cortex plugin's key resolver first (returns Cortex API key for Apollo proxy auth, or env-var fallback) before falling back to local auth profiles. |
| `src/commands/models/auth.ts`                         | Added `assertSelfServiceAuthAllowed()` guard that blocks `login`, `add`, `paste-token`, and `setup-token` unless `SONANCE_ALLOW_SELF_SERVICE_AUTH=1`.                                                                                                                          |
| `src/commands/onboard.ts`                             | Replaced early-exit with real SSO login: runs OAuth PKCE flow against Entra ID, stores tokens, or prints config instructions. Bypass: `SONANCE_ALLOW_ONBOARD=1`.                                                                                                               |
| `src/config/types.gateway.ts`                         | Added `"sonance-sso"` to `GatewayAuthMode`, `SonanceSsoConfig` type (with `entraIdClientId`, `oauthScopes`), and `sonanceSso` field on `GatewayAuthConfig`.                                                                                                                    |
| `src/config/types.tools.ts`                           | Added `"sonance"` to the `ToolProfileId` union type.                                                                                                                                                                                                                           |
| `src/config/zod-schema.agent-runtime.ts`              | Added `z.literal("sonance")` to `ToolProfileSchema`.                                                                                                                                                                                                                           |
| `src/config/zod-schema.ts`                            | Added `z.literal("sonance-sso")` to gateway auth mode schema; added `sonanceSso` object schema (including `entraIdClientId`, `oauthScopes`) under `gateway.auth`.                                                                                                              |
| `src/config/io.ts`                                    | Imported and applied `applySonanceDefaults()` in `loadConfig()` to inject the channel plugin deny list and Cortex plugin auto-enable.                                                                                                                                          |
| `src/gateway/call.ts`                                 | Auto-injects stored Sonance SSO `id_token` as `x-sonance-token` WebSocket upgrade header when `sonance-sso` auth mode is configured.                                                                                                                                           |
| `src/gateway/client.ts`                               | Added `wsHeaders` option to `GatewayClientOptions`; passes headers during WebSocket upgrade handshake.                                                                                                                                                                         |
| `src/tui/gateway-chat.ts`                             | `resolveGatewayConnection` now returns `wsHeaders` with the Sonance SSO token; `GatewayChatClient` passes them to `GatewayClient`.                                                                                                                                             |
| `src/cli/program/command-registry.ts`                 | Registered the new `logout` CLI command.                                                                                                                                                                                                                                       |
| `src/gateway/auth.ts`                                 | Added `"sonance-sso"` auth mode handling in `resolveGatewayAuth`, `assertGatewayAuthConfigured`, and `authorizeGatewayConnect`; stores `SonanceUserIdentity` on auth result.                                                                                                   |
| `src/gateway/server/ws-connection/auth-messages.ts`   | Added Sonance SSO failure message cases to `formatGatewayAuthFailureMessage`.                                                                                                                                                                                                  |
| `src/gateway/server/ws-connection/message-handler.ts` | Populates `nextClient.sonanceUser` from `authResult.sonanceUser` on WebSocket connect.                                                                                                                                                                                         |
| `src/gateway/server/ws-types.ts`                      | Added `sonanceUser?: SonanceUserIdentity` to `GatewayWsClient`.                                                                                                                                                                                                                |
| `src/security/dangerous-tools.ts`                     | Expanded `DEFAULT_GATEWAY_HTTP_TOOL_DENY` and `DANGEROUS_ACP_TOOL_NAMES` with additional high-risk tools (`exec`, `process`, `write`, `edit`, `apply_patch`, `nodes`, `cron`, `browser`).                                                                                      |

## Modified Test Files

| File                                                               | Purpose of Change                                                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/tools-invoke-http.test.ts`                            | Two tests now set `tools: { profile: "full" }` to bypass the Sonance default profile when testing HTTP tool routing.             |
| `src/agents/pi-tools.sandbox-mounted-paths.workspace-only.test.ts` | Tests now pass `config: { tools: { profile: "full" } }` so `read`/`write`/`edit` tools are available for sandbox behavior tests. |

## New Files (Sonance-specific)

| File                                 | Purpose                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/sonance-defaults.ts`     | `SONANCE_DENIED_CHANNEL_PLUGINS` list and `applySonanceDefaults()` — merges channel deny list and Cortex plugin auto-enable into every loaded config.                                     |
| `src/gateway/sonance-sso.ts`         | JWT validation for Sonance SSO: HS256 symmetric + JWKS RS256/ES256 with 10-minute key cache, claim validation, identity extraction.                                                       |
| `src/gateway/sonance-oauth.ts`       | OAuth 2.0 Authorization Code + PKCE flow for Microsoft Entra ID. Opens browser, receives callback on local HTTP server, exchanges code for tokens. Also exports `refreshSonanceTokens()`. |
| `src/gateway/sonance-token-store.ts` | Persists SSO token set (`id_token`, `access_token`, `refresh_token`) to `~/.openclaw/sonance-session.json`. Read/write/clear/load helpers.                                                |
| `src/gateway/sonance-context.ts`     | Thread-safe store mapping session keys to `SonanceUserIdentity` with TTL eviction.                                                                                                        |
| `src/security/sonance-audit.ts`      | Pluggable audit event emitter (`emitAuditEvent`, `setSonanceAuditSink`) for tool-call telemetry.                                                                                          |
| `src/cli/program/register.logout.ts` | Registers `openclaw logout` command — clears stored Sonance SSO tokens.                                                                                                                   |
| `extensions/sonance-cortex/`         | Plugin directory (see below).                                                                                                                                                             |

## Sonance Cortex Plugin (`extensions/sonance-cortex/`)

| File                      | Purpose                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openclaw.plugin.json`    | Plugin manifest with config schema.                                                                                                                                                                                                    |
| `package.json`            | npm package definition.                                                                                                                                                                                                                |
| `index.ts`                | Plugin entry point — wires audit sink, Apollo proxy key resolver (returns Cortex credential for Apollo auth, with env-var fallback), dynamic tool registration, MCP bridge, health service, and `sonance.kill_session` gateway method. |
| `src/config.ts`           | Parses plugin config from `openclaw.json` / env vars.                                                                                                                                                                                  |
| `src/cortex-client.ts`    | HTTP client for the Cortex API: tool discovery, tool execution proxy, audit push, health check.                                                                                                                                        |
| `src/audit-sink.ts`       | Batched audit event buffer that pushes to Cortex on a flush interval.                                                                                                                                                                  |
| `src/mcp-stdio-client.ts` | Stdio MCP client: spawns a child process, does JSON-RPC initialize/tools-list/tools-call, manages lifecycle. Passes `MICROSOFT_ACCESS_TOKEN` env var for SSO token sharing.                                                            |

---

## Environment Variables

| Variable                          | Default                 | Purpose                                                                                                  |
| --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `SONANCE_ALLOW_SELF_SERVICE_AUTH` | `""` (disabled)         | Set to `1` to re-enable `openclaw models auth *` commands.                                               |
| `SONANCE_ALLOW_ONBOARD`           | `""` (disabled)         | Set to `1` to re-enable the standard onboarding wizard.                                                  |
| `SONANCE_CORTEX_API_URL`          | `http://localhost:8900` | Cortex API base URL (fallback when not in config).                                                       |
| `SONANCE_CORTEX_API_KEY`          | `""`                    | Cortex API key (fallback when not in config). Also used as auth token in Apollo proxy mode.              |
| `SONANCE_APOLLO_BASE_URL`         | `""`                    | Apollo proxy URL (e.g. `http://localhost:8000`). When set, the Anthropic provider routes through Apollo. |
| `SONANCE_ANTHROPIC_API_KEY`       | `""`                    | Anthropic API key for direct mode (bypasses Apollo). Falls through to `ANTHROPIC_API_KEY`.               |
| `SONANCE_OPENAI_API_KEY`          | `""`                    | OpenAI API key for direct mode. Falls through to `OPENAI_API_KEY`.                                       |

---

## Configuration Diff (openclaw.json)

### PoC: Direct API Key

Simplest setup — Anthropic key from env var, no Cortex server needed:

```json5
{
  gateway: { mode: "local", auth: { mode: "none" } },
  tools: { profile: "sonance" },
}
```

Set `SONANCE_ANTHROPIC_API_KEY=sk-ant-...` (or `ANTHROPIC_API_KEY`). The
Cortex plugin's central key resolver picks it up automatically.

### PoC: Apollo Proxy

Routes AI requests through Cortex Apollo for rate limiting, billing,
and usage tracking:

```json5
{
  gateway: { mode: "local", auth: { mode: "none" } },
  tools: { profile: "sonance" },
  plugins: {
    entries: {
      "sonance-cortex": {
        enabled: true,
        config: {
          apolloBaseUrl: "http://localhost:8000",
          apiKey: "ctx_your_cortex_api_key",
        },
      },
    },
  },
}
```

When `apolloBaseUrl` is set (or `SONANCE_APOLLO_BASE_URL` env var), the
Anthropic provider's base URL is automatically rewritten to point at Apollo.
The Cortex API key (`ctx_...`) is sent as `x-api-key` — Apollo validates it
via Aegis, then proxies to Anthropic using its own `CORTEX_ANTHROPIC_API_KEY`.

### Production: Full SSO + Apollo

```json5
{
  gateway: {
    auth: {
      mode: "sonance-sso",
      sonanceSso: {
        entraIdTenantId: "your-tenant-id",
        entraIdClientId: "your-app-client-id",
        audience: "api://your-app-client-id",
      },
    },
  },
  tools: { profile: "sonance" },
  plugins: {
    entries: {
      "sonance-cortex": {
        enabled: true,
        config: {
          apiBaseUrl: "https://cortex.sonance.internal",
          apiKey: "ctx_production_key",
          apolloBaseUrl: "https://cortex.sonance.internal",
        },
      },
    },
  },
}
```

Channel plugins are automatically denied by `applySonanceDefaults()` — no
explicit `plugins.deny` is needed.

---

## Apollo Proxy Integration

The Cortex plugin supports routing AI model requests through Cortex Apollo,
which provides rate limiting, usage tracking, cost calculation, and project
grouping. Apollo exposes an Anthropic SDK-compatible endpoint at `/v1/messages`.

### How It Works

Apollo never distributes Anthropic API keys to clients. It operates as a
managed proxy:

```
User (ctx_ API key or JWT)
  → Cortex/Aegis (validates credential, resolves user identity)
  → Apollo (rate limits, model access checks, project grouping)
  → Anthropic (using server-side CORTEX_ANTHROPIC_API_KEY)
  → User gets enriched response with cortex_usage metadata
```

The central key resolver in the Cortex plugin follows this chain:

1. **Apollo proxy** (recommended) — when `apolloBaseUrl` is configured, returns the Cortex API key (`ctx_...`) as the authentication credential. OpenClaw sends it as `x-api-key` to Apollo. Apollo validates it via Aegis, then proxies to Anthropic with the server-side key. The Anthropic provider's `baseUrl` is auto-rewritten to point at Apollo.
2. **Direct fallback** — checks `SONANCE_ANTHROPIC_API_KEY` then `ANTHROPIC_API_KEY` (PoC shortcut, no Cortex needed, no billing/tracking).
3. **Passthrough** — falls through to OpenClaw's built-in auth resolution (env vars, auth profiles).

### New Config Fields

| Field                                                 | Environment Variable      | Purpose                                                                                                      |
| ----------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `plugins.entries.sonance-cortex.config.apolloBaseUrl` | `SONANCE_APOLLO_BASE_URL` | Apollo URL (e.g. `http://localhost:8000`). When set, `models.providers.anthropic.baseUrl` is auto-rewritten. |

---

## Microsoft 365 MCP Integration

The fork supports integrating a Microsoft 365 MCP server for both SSO and
tool access.

### SSO via Microsoft Entra ID

Set `entraIdTenantId` in the SSO config — the JWKS URI and issuer are
auto-derived from it:

```json5
{
  gateway: {
    auth: {
      mode: "sonance-sso",
      sonanceSso: {
        entraIdTenantId: "your-tenant-id-here",
        audience: "api://your-app-client-id",
      },
    },
  },
}
```

This resolves to:

- `jwksUri`: `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`
- `issuer`: `https://login.microsoftonline.com/{tenant}/v2.0`
- `userIdClaim`: `oid` (Entra ID object ID)
- `emailClaim`: `preferred_username`

### M365 MCP Tool Bridge

The Cortex plugin supports two MCP transports:

#### Option A: stdio transport (recommended — matches Claude Desktop config)

This spawns `sonance-m365-mcp` as a child process and communicates via
stdin/stdout JSON-RPC — identical to how Claude integrates MCPs.

```json5
{
  plugins: {
    entries: {
      "sonance-cortex": {
        enabled: true,
        config: {
          mcpServers: [
            {
              name: "sonance_m365",
              command: "npx",
              args: ["-y", "sonance-m365-mcp"],
              registerTools: true,
            },
          ],
        },
      },
    },
  },
  tools: { profile: "sonance", alsoAllow: ["sonance_m365_*"] },
}
```

The `transport` field is auto-detected: if `command` is present, it defaults
to `"stdio"`. If `url` is present, it defaults to `"http"`.

#### Option B: HTTP transport (for remote/containerized MCPs)

If the M365 MCP is running as an HTTP server:

```json5
{
  plugins: {
    entries: {
      "sonance-cortex": {
        enabled: true,
        config: {
          mcpServers: [
            {
              name: "m365",
              url: "http://localhost:3001",
              apiKey: "your-mcp-api-key",
              registerTools: true,
            },
          ],
        },
      },
    },
  },
  tools: { profile: "sonance", alsoAllow: ["m365_*"] },
}
```

#### How it works

Tools are registered with a `{name}_` prefix (e.g. `sonance_m365_read_email`,
`sonance_m365_list_calendar_events`). Use `tools.alsoAllow` with a glob
pattern to allow them through the `sonance` profile.

New files for stdio MCP support:

- `extensions/sonance-cortex/src/mcp-stdio-client.ts` — spawns the process,
  handles JSON-RPC initialize/tools-list/tools-call, manages lifecycle.

---

## Upstream Merge Notes

When rebasing onto a new upstream release:

1. **Tool policy** — check `src/agents/tool-policy.ts` for new tool groups or
   profile changes. The `sonance` profile/group may need updating.
2. **Auth** — check `src/gateway/auth.ts` for new auth modes or flow changes.
3. **Config schema** — check `src/config/zod-schema.ts` and `types.gateway.ts`
   for schema refactors.
4. **Plugin API** — check `src/plugins/` for `registerTool` / `registerService`
   signature changes that affect the Cortex plugin.
5. **Onboarding** — check `src/commands/onboard.ts` and `src/wizard/` for new
   wizard steps or refactors.
6. **Tests** — search for `profile: "full"` in test files to find tests that
   explicitly bypass the Sonance profile.
