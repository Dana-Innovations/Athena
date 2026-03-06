/**
 * File storage abstraction for agent workspaces.
 *
 * Implementations:
 *  - LocalFsProvider   (development — local filesystem)
 *  - AzureBlobProvider (production — Azure Blob Storage)
 */

export interface FileStorageProvider {
  /** Read a file from an agent's storage. Returns null if not found. */
  read(agentId: string, path: string): Promise<Buffer | null>;

  /** Write a file to an agent's storage. Creates parent directories if needed. */
  write(agentId: string, path: string, data: Buffer | string): Promise<void>;

  /** List files under a prefix within an agent's storage. */
  list(agentId: string, prefix: string): Promise<string[]>;

  /** Delete a file from an agent's storage. Idempotent (no error if missing). */
  delete(agentId: string, path: string): Promise<void>;

  /** Check if a file exists in an agent's storage. */
  exists(agentId: string, path: string): Promise<boolean>;

  /** Get storage quota usage for an agent. */
  getQuotaUsage(agentId: string): Promise<{ usedBytes: number; limitBytes: number }>;
}

/** Parse a quota string like "1GB", "500MB" into bytes. */
export function parseQuota(quota: string): number {
  const match = quota.match(/^(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)$/i);
  if (!match) {
    return 1_073_741_824;
  } // default 1 GB
  const value = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
  };
  return Math.floor(value * (multipliers[unit] ?? 1));
}
