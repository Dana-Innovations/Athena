/**
 * Azure Blob Storage implementation of FileStorageProvider.
 *
 * Blob layout:
 *   {containerName}/
 *     {agentId}/workspace/...
 *     {agentId}/soul/SOUL.md
 *     {agentId}/memory/memory.md
 *     {agentId}/cache/...
 *
 * Configured via environment variables:
 *   AZURE_STORAGE_CONNECTION_STRING — full connection string (preferred)
 *   AZURE_STORAGE_ACCOUNT_NAME + AZURE_STORAGE_ACCOUNT_KEY — alternative
 *   ATHENA_BLOB_CONTAINER — container name (default: "agents")
 */
import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import type { FileStorageProvider } from "./types.js";
import { parseQuota } from "./types.js";

export class AzureBlobProvider implements FileStorageProvider {
  private readonly container: ContainerClient;
  private readonly quotaBytes: number;
  private initialized = false;

  constructor(container: ContainerClient, quota = "1GB") {
    this.container = container;
    this.quotaBytes = parseQuota(quota);
  }

  /**
   * Create an AzureBlobProvider from environment variables.
   * Returns null if required variables are missing (graceful fallback).
   */
  static fromEnv(quota = "1GB"): AzureBlobProvider | null {
    const containerName = process.env.ATHENA_BLOB_CONTAINER?.trim() || "agents";
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();

    if (connStr) {
      const serviceClient = BlobServiceClient.fromConnectionString(connStr);
      return new AzureBlobProvider(serviceClient.getContainerClient(containerName), quota);
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim();
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY?.trim();

    if (accountName && accountKey) {
      const cred = new StorageSharedKeyCredential(accountName, accountKey);
      const serviceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        cred,
      );
      return new AzureBlobProvider(serviceClient.getContainerClient(containerName), quota);
    }

    return null;
  }

  private async ensureContainer(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.container.createIfNotExists();
    this.initialized = true;
  }

  private blobPath(agentId: string, path: string): string {
    const normalized = path.replace(/^\//, "").replace(/\\/g, "/");
    if (normalized.includes("..")) {
      throw new Error(`Path traversal denied: ${path}`);
    }
    return `${agentId}/${normalized}`;
  }

  async read(agentId: string, path: string): Promise<Buffer | null> {
    await this.ensureContainer();
    const blobClient = this.container.getBlobClient(this.blobPath(agentId, path));
    try {
      const response = await blobClient.download(0);
      const chunks: Buffer[] = [];
      if (response.readableStreamBody) {
        for await (const chunk of response.readableStreamBody as AsyncIterable<Buffer>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  async write(agentId: string, path: string, data: Buffer | string): Promise<void> {
    await this.ensureContainer();
    const blockBlob = this.container.getBlockBlobClient(this.blobPath(agentId, path));
    const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
    await blockBlob.upload(buf, buf.length, {
      blobHTTPHeaders: { blobContentType: guessContentType(path) },
    });
  }

  async list(agentId: string, prefix: string): Promise<string[]> {
    await this.ensureContainer();
    const fullPrefix = this.blobPath(agentId, prefix || "");
    const results: string[] = [];
    const agentPrefix = `${agentId}/`;

    for await (const blob of this.container.listBlobsFlat({ prefix: fullPrefix })) {
      if (blob.name.startsWith(agentPrefix)) {
        results.push(blob.name.slice(agentPrefix.length));
      }
    }
    return results;
  }

  async delete(agentId: string, path: string): Promise<void> {
    await this.ensureContainer();
    const blobClient = this.container.getBlobClient(this.blobPath(agentId, path));
    try {
      await blobClient.deleteIfExists();
    } catch {
      // Idempotent — ignore errors
    }
  }

  async exists(agentId: string, path: string): Promise<boolean> {
    await this.ensureContainer();
    const blobClient = this.container.getBlobClient(this.blobPath(agentId, path));
    return blobClient.exists();
  }

  async getQuotaUsage(agentId: string): Promise<{ usedBytes: number; limitBytes: number }> {
    await this.ensureContainer();
    let total = 0;
    const prefix = `${agentId}/`;
    for await (const blob of this.container.listBlobsFlat({ prefix })) {
      total += blob.properties.contentLength ?? 0;
    }
    return { usedBytes: total, limitBytes: this.quotaBytes };
  }
}

function isNotFoundError(err: unknown): boolean {
  if (err && typeof err === "object" && "statusCode" in err) {
    return (err as { statusCode: number }).statusCode === 404;
  }
  return false;
}

function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    json: "application/json; charset=utf-8",
    yaml: "text/yaml; charset=utf-8",
    yml: "text/yaml; charset=utf-8",
    html: "text/html; charset=utf-8",
    csv: "text/csv; charset=utf-8",
  };
  return types[ext ?? ""] ?? "application/octet-stream";
}
