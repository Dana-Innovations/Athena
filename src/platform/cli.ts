#!/usr/bin/env node
/**
 * Athena Platform CLI — standalone entry point
 *
 * Usage:
 *   bun src/platform/cli.ts validate [--init-db]
 *   bun src/platform/cli.ts list [--json]
 *   bun src/platform/cli.ts db:init
 *   bun src/platform/cli.ts db:stats
 */
import { resolve } from "node:path";
import { AthenaSqliteProvider } from "./database/index.js";
import { loadAgentRegistry } from "./registry.js";
import { validatePlatform, formatValidationReport, formatAgentList } from "./validate.js";

const ROOT_DIR = resolve(import.meta.dirname ?? ".", "../..");
const DB_PATH = resolve(ROOT_DIR, ".local-dev/athena.db");

const command = process.argv[2];
const flags = new Set(process.argv.slice(3));

async function main() {
  switch (command) {
    case "validate": {
      const result = await validatePlatform({
        rootDir: ROOT_DIR,
        initDb: flags.has("--init-db"),
        dbPath: DB_PATH,
      });
      console.log(formatValidationReport(result));
      process.exit(result.registry.errors.length > 0 ? 1 : 0);
      break;
    }

    case "list": {
      const registry = loadAgentRegistry(ROOT_DIR);
      if (flags.has("--json")) {
        const data = registry.agents.map((e) => ({
          name: e.definition.metadata.name,
          displayName: e.definition.metadata.displayName,
          owner: e.definition.metadata.owner,
          mcps: e.definition.spec.skills?.cortex?.mcps ?? [],
          gateways: Object.entries(e.definition.spec.gateways ?? {})
            .filter(([, v]) => v?.enabled)
            .map(([k]) => k),
        }));
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(formatAgentList(registry));
      }
      break;
    }

    case "db:init": {
      console.log(`Initializing database at ${DB_PATH}...`);
      const provider = new AthenaSqliteProvider(DB_PATH);
      provider.initSchema();
      const stats = provider.getTableStats();
      console.log("Database initialized. Tables:");
      for (const [table, count] of Object.entries(stats)) {
        console.log(`  ${table}: ${count} rows`);
      }
      provider.close();
      console.log("Done.");
      break;
    }

    case "db:stats": {
      const provider = new AthenaSqliteProvider(DB_PATH);
      provider.initSchema();
      const stats = provider.getTableStats();
      console.log("Database stats:");
      for (const [table, count] of Object.entries(stats)) {
        console.log(`  ${table}: ${count} rows`);
      }
      provider.close();
      break;
    }

    default:
      console.log(`
Athena Platform CLI

Commands:
  validate [--init-db]   Validate all agent definitions (optionally init local DB)
  list [--json]          List all defined agents
  db:init                Initialize the local SQLite database
  db:stats               Show database table row counts

Usage:
  bun src/platform/cli.ts validate --init-db
  bun src/platform/cli.ts list --json
`);
      break;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
