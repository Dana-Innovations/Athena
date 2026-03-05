/**
 * Local filesystem implementation of FileStorageProvider.
 * Used for development — mirrors the blob storage layout on disk.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { FileStorageProvider } from "./types.js";
import { parseQuota } from "./types.js";

export class LocalFsProvider implements FileStorageProvider {
  private readonly baseDir: string;
  private readonly quotaBytes: number;

  constructor(baseDir: string, quota = "1GB") {
    this.baseDir = resolve(baseDir);
    this.quotaBytes = parseQuota(quota);
    mkdirSync(this.baseDir, { recursive: true });
  }

  private resolvePath(agentId: string, path: string): string {
    const resolved = resolve(this.baseDir, agentId, path.replace(/^\//, ""));
    if (!resolved.startsWith(resolve(this.baseDir, agentId))) {
      throw new Error(`Path traversal denied: ${path}`);
    }
    return resolved;
  }

  async read(agentId: string, path: string): Promise<Buffer | null> {
    const fullPath = this.resolvePath(agentId, path);
    if (!existsSync(fullPath)) {
      return null;
    }
    return readFileSync(fullPath);
  }

  async write(agentId: string, path: string, data: Buffer | string): Promise<void> {
    const fullPath = this.resolvePath(agentId, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, data);
  }

  async list(agentId: string, prefix: string): Promise<string[]> {
    const dir = this.resolvePath(agentId, prefix);
    if (!existsSync(dir)) {
      return [];
    }
    const results: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          results.push(relative(resolve(this.baseDir, agentId), full));
        }
      }
    };
    walk(dir);
    return results;
  }

  async delete(agentId: string, path: string): Promise<void> {
    const fullPath = this.resolvePath(agentId, path);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  }

  async exists(agentId: string, path: string): Promise<boolean> {
    return existsSync(this.resolvePath(agentId, path));
  }

  async getQuotaUsage(agentId: string): Promise<{ usedBytes: number; limitBytes: number }> {
    const agentDir = resolve(this.baseDir, agentId);
    if (!existsSync(agentDir)) {
      return { usedBytes: 0, limitBytes: this.quotaBytes };
    }
    let total = 0;
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          total += statSync(full).size;
        }
      }
    };
    walk(agentDir);
    return { usedBytes: total, limitBytes: this.quotaBytes };
  }
}
