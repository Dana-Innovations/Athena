/**
 * SOUL.md versioning for durable storage.
 *
 * Before overwriting the active SOUL.md, the current version is copied
 * to soul/SOUL.v{N}.md. Only the last MAX_VERSIONS copies are kept;
 * older ones are pruned. This enables hot rollback from the Admin Portal
 * without a redeploy.
 *
 * Blob layout after several writes:
 *   {agentId}/soul/SOUL.md       ← current (active)
 *   {agentId}/soul/SOUL.v5.md    ← newest backup
 *   {agentId}/soul/SOUL.v4.md
 *   {agentId}/soul/SOUL.v3.md
 *   ...
 *   {agentId}/soul/SOUL.v1.md    ← oldest kept backup
 */
import type { FileStorageProvider } from "./types.js";

const MAX_VERSIONS = 10;
const SOUL_PATH = "soul/SOUL.md";
const VERSION_RE = /^soul\/SOUL\.v(\d+)\.md$/;

/**
 * Write a new SOUL.md, archiving the previous version first.
 *
 * Skips the version rotation if:
 *  - The file doesn't exist yet (first write)
 *  - The content is identical to the current version
 */
export async function writeSoulVersioned(
  storage: FileStorageProvider,
  agentId: string,
  content: string,
): Promise<void> {
  const existing = await storage.read(agentId, SOUL_PATH);

  if (existing !== null) {
    const existingText = existing.toString("utf-8");
    if (existingText === content) {
      return;
    }
    await archiveCurrentVersion(storage, agentId, existing);
  }

  await storage.write(agentId, SOUL_PATH, content);
}

/**
 * List available SOUL.md versions for an agent (newest first).
 * Returns the version numbers, e.g. [5, 4, 3, 2, 1].
 */
export async function listSoulVersions(
  storage: FileStorageProvider,
  agentId: string,
): Promise<number[]> {
  const files = await storage.list(agentId, "soul/");
  const versions: number[] = [];
  for (const f of files) {
    const match = VERSION_RE.exec(f);
    if (match) {
      versions.push(Number(match[1]));
    }
  }
  return versions.toSorted((a, b) => b - a);
}

/**
 * Rollback: replace the active SOUL.md with a specific version.
 * The current active version is archived first (so it becomes the
 * newest backup and no content is lost).
 *
 * Returns the restored content, or null if the version doesn't exist.
 */
export async function rollbackSoul(
  storage: FileStorageProvider,
  agentId: string,
  version: number,
): Promise<string | null> {
  const versionPath = `soul/SOUL.v${version}.md`;
  const versionBuf = await storage.read(agentId, versionPath);
  if (!versionBuf) {
    return null;
  }

  const current = await storage.read(agentId, SOUL_PATH);
  if (current) {
    await archiveCurrentVersion(storage, agentId, current);
  }

  const restored = versionBuf.toString("utf-8");
  await storage.write(agentId, SOUL_PATH, restored);
  return restored;
}

async function archiveCurrentVersion(
  storage: FileStorageProvider,
  agentId: string,
  currentContent: Buffer,
): Promise<void> {
  const versions = await listSoulVersions(storage, agentId);
  const nextVersion = versions.length > 0 ? versions[0] + 1 : 1;

  await storage.write(agentId, `soul/SOUL.v${nextVersion}.md`, currentContent);

  const toPrune = versions.filter((v) => v <= nextVersion - MAX_VERSIONS);
  await Promise.all(toPrune.map((v) => storage.delete(agentId, `soul/SOUL.v${v}.md`)));
}
