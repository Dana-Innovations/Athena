/**
 * Storage provider factory.
 *
 * Selection order:
 *   1. If AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME is set → AzureBlobProvider
 *   2. Otherwise → LocalFsProvider (writes to {stateDir}/agents/)
 *
 * The provider is created once and cached for the process lifetime.
 */
import { join } from "node:path";
import { AzureBlobProvider } from "./azure-blob.js";
import { LocalFsProvider } from "./local-fs.js";
import type { FileStorageProvider } from "./types.js";

export type { FileStorageProvider } from "./types.js";
export { parseQuota } from "./types.js";
export { LocalFsProvider } from "./local-fs.js";
export { AzureBlobProvider } from "./azure-blob.js";
export { writeSoulVersioned, listSoulVersions, rollbackSoul } from "./soul-versioning.js";

let cachedProvider: FileStorageProvider | null = null;

export function resolveStorageProvider(stateDir: string, quota = "1GB"): FileStorageProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  // Attempt Azure Blob first (production)
  if (
    process.env.AZURE_STORAGE_CONNECTION_STRING?.trim() ||
    process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim()
  ) {
    const provider = AzureBlobProvider.fromEnv(quota);
    if (provider) {
      console.log("[platform] storage: AzureBlobProvider");
      cachedProvider = provider;
      return provider;
    }
  }

  // Fallback: local filesystem (development)
  const provider = new LocalFsProvider(join(stateDir, "agents"), quota);
  console.log(`[platform] storage: LocalFsProvider at ${join(stateDir, "agents")}`);
  cachedProvider = provider;
  return provider;
}

/** Reset the cached provider (for testing). */
export function resetStorageProvider(): void {
  cachedProvider = null;
}
