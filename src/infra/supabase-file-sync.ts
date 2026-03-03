/**
 * Lightweight Supabase PostgREST client for syncing agent workspace files
 * to the `mcp_agent_files` table in the Cortex Supabase project.
 *
 * Uses native fetch — no @supabase/supabase-js dependency required.
 *
 * Configure via environment variables:
 *   CORTEX_SUPABASE_URL       — Supabase project URL (e.g., https://xxx.supabase.co)
 *   CORTEX_SUPABASE_ANON_KEY  — Anon/publishable key (RLS is open on mcp_agent_files)
 *
 * If either variable is missing, all operations silently no-op.
 */

type SyncLogger = {
  info(msg: string): void;
  warn(msg: string): void;
};

const TABLE = "mcp_agent_files";

function getConfig(): { url: string; key: string } | null {
  const url = process.env.CORTEX_SUPABASE_URL?.trim();
  const key = process.env.CORTEX_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), key };
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };
}

/**
 * Upsert a single agent file to Supabase (fire-and-forget).
 * Conflicts on (agent_id, file_name) are resolved via merge.
 */
export async function upsertAgentFile(
  agentId: string,
  fileName: string,
  content: string,
  logger?: SyncLogger,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg) {
    return;
  }

  try {
    const res = await fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: headers(cfg.key),
      body: JSON.stringify({
        agent_id: agentId,
        file_name: fileName,
        content,
        file_size: Buffer.byteLength(content, "utf-8"),
        content_hash: simpleHash(content),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger?.warn(
        `[supabase-sync] upsert failed for ${agentId}/${fileName}: ${res.status} ${text}`,
      );
    }
  } catch (err) {
    logger?.warn(`[supabase-sync] upsert error for ${agentId}/${fileName}: ${String(err)}`);
  }
}

/**
 * Fetch all files for an agent from Supabase.
 * Returns an array of { file_name, content } objects, or empty array on failure.
 */
export async function fetchAgentFiles(
  agentId: string,
  logger?: SyncLogger,
): Promise<Array<{ file_name: string; content: string }>> {
  const cfg = getConfig();
  if (!cfg) {
    return [];
  }

  try {
    const qs = `agent_id=eq.${encodeURIComponent(agentId)}&select=file_name,content`;
    const res = await fetch(`${cfg.url}/rest/v1/${TABLE}?${qs}`, {
      method: "GET",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger?.warn(`[supabase-sync] fetch failed for ${agentId}: ${res.status} ${text}`);
      return [];
    }
    return (await res.json()) as Array<{ file_name: string; content: string }>;
  } catch (err) {
    logger?.warn(`[supabase-sync] fetch error for ${agentId}: ${String(err)}`);
    return [];
  }
}

/** Simple string hash for change detection (not cryptographic). */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
