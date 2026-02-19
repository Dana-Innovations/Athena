import { formatCliCommand } from "../cli/command-format.js";
import { readConfigFileSnapshot } from "../config/config.js";
import { loadConfig } from "../config/io.js";
import { assertSupportedRuntime } from "../infra/runtime-guard.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import { isDeprecatedAuthChoice, normalizeLegacyOnboardAuthChoice } from "./auth-choice-legacy.js";
import { DEFAULT_WORKSPACE, handleReset } from "./onboard-helpers.js";
import { runInteractiveOnboarding } from "./onboard-interactive.js";
import { runNonInteractiveOnboarding } from "./onboard-non-interactive.js";
import type { OnboardOptions } from "./onboard-types.js";

export async function onboardCommand(opts: OnboardOptions, runtime: RuntimeEnv = defaultRuntime) {
  assertSupportedRuntime(runtime);

  // Sonance fork: replace the standard onboarding wizard.
  // Two modes:
  //   1. Local PoC (default) — no SSO, M365 MCP handles its own auth.
  //      Verifies Cortex connectivity and M365 MCP availability.
  //   2. Centralized SSO — when entraIdTenantId + entraIdClientId are set,
  //      runs OAuth PKCE for unified gateway + M365 auth.
  // Bypass to upstream wizard: SONANCE_ALLOW_ONBOARD=1
  if (process.env.SONANCE_ALLOW_ONBOARD !== "1") {
    const config = loadConfig();
    const ssoConfig = config.gateway?.auth?.sonanceSso;
    const tenantId = ssoConfig?.entraIdTenantId ?? process.env.SONANCE_ENTRA_TENANT_ID;
    const clientId = ssoConfig?.entraIdClientId ?? process.env.SONANCE_ENTRA_CLIENT_ID;
    const hasSsoConfig = Boolean(tenantId && clientId);

    if (hasSsoConfig) {
      // --- Centralized SSO mode ---
      await runSonanceSsoOnboard(runtime, ssoConfig!, tenantId!, clientId!);
    } else {
      // --- Local PoC mode ---
      await runSonanceLocalOnboard(runtime, config);
    }
    return;
  }
  const originalAuthChoice = opts.authChoice;
  const normalizedAuthChoice = normalizeLegacyOnboardAuthChoice(originalAuthChoice);
  if (opts.nonInteractive && isDeprecatedAuthChoice(originalAuthChoice)) {
    runtime.error(
      [
        `Auth choice "${String(originalAuthChoice)}" is deprecated.`,
        'Use "--auth-choice token" (Anthropic setup-token) or "--auth-choice openai-codex".',
      ].join("\n"),
    );
    runtime.exit(1);
    return;
  }
  if (originalAuthChoice === "claude-cli") {
    runtime.log('Auth choice "claude-cli" is deprecated; using setup-token flow instead.');
  }
  if (originalAuthChoice === "codex-cli") {
    runtime.log('Auth choice "codex-cli" is deprecated; using OpenAI Codex OAuth instead.');
  }
  const flow = opts.flow === "manual" ? ("advanced" as const) : opts.flow;
  const normalizedOpts =
    normalizedAuthChoice === opts.authChoice && flow === opts.flow
      ? opts
      : { ...opts, authChoice: normalizedAuthChoice, flow };

  if (normalizedOpts.nonInteractive && normalizedOpts.acceptRisk !== true) {
    runtime.error(
      [
        "Non-interactive onboarding requires explicit risk acknowledgement.",
        "Read: https://docs.openclaw.ai/security",
        `Re-run with: ${formatCliCommand("openclaw onboard --non-interactive --accept-risk ...")}`,
      ].join("\n"),
    );
    runtime.exit(1);
    return;
  }

  if (normalizedOpts.reset) {
    const snapshot = await readConfigFileSnapshot();
    const baseConfig = snapshot.valid ? snapshot.config : {};
    const workspaceDefault =
      normalizedOpts.workspace ?? baseConfig.agents?.defaults?.workspace ?? DEFAULT_WORKSPACE;
    await handleReset("full", resolveUserPath(workspaceDefault), runtime);
  }

  if (process.platform === "win32") {
    runtime.log(
      [
        "Windows detected — OpenClaw runs great on WSL2!",
        "Native Windows might be trickier.",
        "Quick setup: wsl --install (one command, one reboot)",
        "Guide: https://docs.openclaw.ai/windows",
      ].join("\n"),
    );
  }

  if (normalizedOpts.nonInteractive) {
    await runNonInteractiveOnboarding(normalizedOpts, runtime);
    return;
  }

  await runInteractiveOnboarding(normalizedOpts, runtime);
}

export type { OnboardOptions } from "./onboard-types.js";

// ---------------------------------------------------------------------------
// Sonance onboarding modes
// ---------------------------------------------------------------------------

/**
 * Local PoC onboarding: no SSO required.
 * Checks that the Cortex plugin is enabled and the M365 MCP is reachable,
 * then prints next steps.
 */
async function runSonanceLocalOnboard(
  runtime: RuntimeEnv,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  runtime.log("Sonance local setup");
  runtime.log("=".repeat(40));
  runtime.log("");

  // 1. Check Cortex plugin
  const cortexEnabled =
    (config.plugins as Record<string, unknown> | undefined)?.entries != null &&
    ((config.plugins as Record<string, unknown>).entries as Record<string, unknown>)?.[
      "sonance-cortex"
    ] != null;
  const cortexConfig = cortexEnabled
    ? (
        ((config.plugins as Record<string, unknown>).entries as Record<string, unknown>)[
          "sonance-cortex"
        ] as Record<string, unknown>
      )?.config
    : undefined;
  const cortexApiKey =
    (cortexConfig as Record<string, unknown> | undefined)?.apiKey ??
    process.env.SONANCE_CORTEX_API_KEY;

  if (cortexApiKey) {
    runtime.log("[ok] Cortex plugin enabled with API key configured");
  } else {
    runtime.log("[--] Cortex plugin: no API key found");
    runtime.log("     Set SONANCE_CORTEX_API_KEY or plugins.entries.sonance-cortex.config.apiKey");
  }

  // 2. Check M365 MCP availability
  runtime.log("");
  runtime.log("Checking sonance-m365-mcp availability...");
  try {
    const { StdioMcpClient } =
      await import("../../extensions/sonance-cortex/src/mcp-stdio-client.js");
    const client = new StdioMcpClient({ command: "npx", args: ["-y", "sonance-m365-mcp"] });
    await client.start();
    const tools = await client.listTools();
    await client.stop();
    runtime.log("[ok] sonance-m365-mcp found — " + tools.length + " tool(s) available:");
    for (const t of tools.slice(0, 8)) {
      runtime.log("     - " + t.name);
    }
    if (tools.length > 8) {
      runtime.log("     ... and " + (tools.length - 8) + " more");
    }
  } catch {
    runtime.log("[--] sonance-m365-mcp not reachable (npx may need to download it first)");
    runtime.log("     The MCP will auto-start when the gateway loads — this is OK.");
  }

  // 3. Check API key availability
  runtime.log("");
  const hasApolloUrl =
    process.env.SONANCE_APOLLO_BASE_URL?.trim() ||
    (cortexConfig as Record<string, unknown> | undefined)?.apolloBaseUrl;
  const hasAnthropicKey =
    process.env.SONANCE_ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim();

  if (hasApolloUrl) {
    runtime.log("[ok] Apollo proxy mode: AI requests route through Cortex Apollo");
    runtime.log(
      "     URL: " +
        (typeof hasApolloUrl === "string" ? hasApolloUrl : JSON.stringify(hasApolloUrl)),
    );
  } else if (hasAnthropicKey) {
    runtime.log("[ok] Anthropic API key found (direct mode)");
  } else {
    runtime.log("[--] No API key for AI models found");
    runtime.log(
      "     Option A (Apollo proxy): set SONANCE_APOLLO_BASE_URL + SONANCE_CORTEX_API_KEY",
    );
    runtime.log("     Option B (direct key):   set SONANCE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY");
  }

  // 4. Print next steps
  runtime.log("");
  runtime.log("=".repeat(40));
  runtime.log("");
  runtime.log("Next steps:");
  runtime.log("");
  if (!hasApolloUrl && !hasAnthropicKey) {
    runtime.log("  1. Provide an AI model key (pick one):");
    runtime.log("");
    runtime.log("     a) Apollo proxy (recommended — billing & rate limits via Cortex):");
    runtime.log("        export SONANCE_APOLLO_BASE_URL=http://localhost:8000");
    runtime.log("        export SONANCE_CORTEX_API_KEY=ctx_your_key_here");
    runtime.log("");
    runtime.log("     b) Direct Anthropic key (simple PoC):");
    runtime.log("        export SONANCE_ANTHROPIC_API_KEY=sk-ant-your-key-here");
    runtime.log("");
    runtime.log("  2. Start the gateway:");
  } else {
    runtime.log("  1. Start the gateway:");
  }
  runtime.log("     pnpm openclaw gateway run");
  runtime.log("");
  runtime.log(
    "  " +
      (hasApolloUrl || hasAnthropicKey ? "2" : "3") +
      ". When you use an M365 tool for the first time, a browser",
  );
  runtime.log("     will open for Microsoft sign-in. Sign in with @sonance.com.");
  runtime.log("");
  runtime.log("To upgrade to centralized SSO later, add to openclaw.json:");
  runtime.log('  gateway.auth.sonanceSso.entraIdTenantId: "your-tenant-id"');
  runtime.log('  gateway.auth.sonanceSso.entraIdClientId: "your-client-id"');
  runtime.log('  gateway.auth.mode: "sonance-sso"');

  runtime.exit(0);
}

/**
 * Centralized SSO onboarding: runs OAuth PKCE against Entra ID.
 * Produces tokens for both gateway auth (id_token) and M365 (access_token).
 */
async function runSonanceSsoOnboard(
  runtime: RuntimeEnv,
  ssoConfig: NonNullable<ReturnType<typeof loadConfig>["gateway"]>["auth"] extends {
    sonanceSso?: infer S;
  }
    ? NonNullable<S>
    : never,
  tenantId: string,
  clientId: string,
): Promise<void> {
  try {
    const { runSonanceOAuthFlow } = await import("../gateway/sonance-oauth.js");
    const { saveSonanceTokens, loadSonanceTokens } =
      await import("../gateway/sonance-token-store.js");

    const existing = loadSonanceTokens();
    if (existing) {
      runtime.log(
        [
          "You are already signed in to Sonance SSO.",
          "",
          "To sign in as a different user, run:",
          "  openclaw logout",
          "",
          "To start the gateway:",
          "  openclaw gateway run",
        ].join("\n"),
      );
      runtime.exit(0);
      return;
    }

    const extraScopes = ssoConfig?.oauthScopes ?? [];
    const result = await runSonanceOAuthFlow(
      { tenantId, clientId, scopes: extraScopes },
      (url) => {
        void import("node:child_process").then(({ exec }) => {
          const cmd =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "start"
                : "xdg-open";
          exec(cmd + " " + JSON.stringify(url));
        });
      },
      (msg) => runtime.log(msg),
    );

    const expiresAt = result.expiresIn
      ? Math.floor(Date.now() / 1000) + result.expiresIn
      : undefined;

    saveSonanceTokens({
      idToken: result.idToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt,
      tenantId,
      scopes: result.scope?.split(" "),
    });

    runtime.log(
      [
        "",
        "Signed in to Sonance SSO successfully!",
        "",
        "Your session has been saved. To start the gateway:",
        "  openclaw gateway run",
        "",
        "The M365 MCP will use this same session for Microsoft 365 data access.",
      ].join("\n"),
    );
    runtime.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runtime.error("Sonance SSO sign-in failed: " + msg);
    runtime.exit(1);
  }
}
