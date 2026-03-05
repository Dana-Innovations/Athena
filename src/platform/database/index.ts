/**
 * Athena Platform Database — barrel export + factory.
 *
 * Reads env vars to decide which provider to instantiate:
 *   - ATHENA_SUPABASE_URL + ATHENA_SUPABASE_SERVICE_ROLE_KEY → Supabase
 *   - Otherwise → SQLite at ATHENA_DB_PATH (default: .local-dev/athena.db)
 */
import { resolve } from "node:path";
import { AthenaSqliteProvider } from "./sqlite-provider.js";
import { AthenaSupabaseProvider } from "./supabase-provider.js";
import type { AthenaDatabase } from "./types.js";

export type { AthenaDatabase } from "./types.js";
export type {
  AgentStats,
  AuditEvent,
  AuditFilter,
  Conversation,
  ConversationFilter,
  CronJob,
  CronRun,
  ListOptions,
  MemoryEntry,
  MemoryFilter,
  Message,
  MessageFilter,
  MetricsFilter,
  PlatformStats,
  UsageMetric,
} from "./types.js";
export { AthenaSqliteProvider } from "./sqlite-provider.js";
export { AthenaSupabaseProvider } from "./supabase-provider.js";

let _instance: AthenaDatabase | null = null;

/**
 * Create (or return cached) AthenaDatabase instance based on environment.
 *
 * Call `initSchema()` after creation if this is the first startup.
 */
export function createAthenaDatabase(opts?: { rootDir?: string; force?: boolean }): AthenaDatabase {
  if (_instance && !opts?.force) {
    return _instance;
  }

  const supabaseUrl = process.env.ATHENA_SUPABASE_URL?.trim();
  const supabaseKey = process.env.ATHENA_SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (supabaseUrl && supabaseKey) {
    _instance = new AthenaSupabaseProvider({ url: supabaseUrl, serviceRoleKey: supabaseKey });
  } else {
    const rootDir = opts?.rootDir ?? process.env.ATHENA_REPO_ROOT ?? process.cwd();
    const dbPath = process.env.ATHENA_DB_PATH?.trim() || resolve(rootDir, ".local-dev/athena.db");
    _instance = new AthenaSqliteProvider(dbPath);
  }

  return _instance;
}

/** Get the cached instance (throws if not yet created). */
export function getAthenaDatabase(): AthenaDatabase {
  if (!_instance) {
    throw new Error("AthenaDatabase not initialized — call createAthenaDatabase() first");
  }
  return _instance;
}
