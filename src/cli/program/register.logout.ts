import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerLogoutCommand(program: Command) {
  program
    .command("logout")
    .description("Sign out of Sonance SSO and clear stored tokens")
    .action(async () => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const { clearSonanceTokens, loadSonanceTokens } =
          await import("../../gateway/sonance-token-store.js");
        const existing = loadSonanceTokens();
        if (!existing) {
          defaultRuntime.log("No Sonance SSO session found — already signed out.");
          return;
        }
        clearSonanceTokens();
        defaultRuntime.log("Signed out of Sonance SSO. Stored tokens have been removed.");
      });
    });
}
