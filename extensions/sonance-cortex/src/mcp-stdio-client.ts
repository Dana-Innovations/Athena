/**
 * Stdio MCP Client
 *
 * Spawns a local MCP server process and communicates over stdin/stdout using
 * the JSON-RPC 2.0 protocol defined by the Model Context Protocol.
 *
 * Handles:
 *   - Process lifecycle (spawn, graceful shutdown)
 *   - JSON-RPC request/response correlation
 *   - tools/list discovery
 *   - tools/call execution
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

export type McpToolCallResult = {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

export type StdioMcpClientConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export class StdioMcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private ready = false;

  config: StdioMcpClientConfig;

  constructor(config: StdioMcpClientConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const env = { ...process.env, ...(this.config.env ?? {}) };
    this.proc = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.cwd ?? process.cwd(),
      env,
      windowsHide: true,
    });

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error("Failed to open stdio pipes to MCP server");
    }

    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id != null && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(msg.error.message));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch {
        // Non-JSON lines from server (e.g. logging) — ignore
      }
    });

    this.proc.on("error", (err) => {
      for (const [, handler] of this.pending) {
        handler.reject(err);
      }
      this.pending.clear();
    });

    this.proc.on("exit", () => {
      for (const [, handler] of this.pending) {
        handler.reject(new Error("MCP server process exited"));
      }
      this.pending.clear();
      this.ready = false;
    });

    // Initialize the MCP session
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openclaw-sonance", version: "1.0.0" },
    });

    // Send initialized notification (no id = notification)
    this.notify("notifications/initialized", {});
    this.ready = true;
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error("MCP server stdin not writable"));
        return;
      }

      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params: params ?? {} };
      this.proc.stdin.write(JSON.stringify(msg) + "\n");

      // Timeout after 30s for discovery, 120s for tool calls
      const timeoutMs = method === "tools/call" ? 120_000 : 30_000;
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("MCP request timed out: " + method));
        }
      }, timeoutMs);
    });
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) return;
    const msg = { jsonrpc: "2.0", method, params: params ?? {} };
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpToolDef[] };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as McpToolCallResult;
    return result;
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      this.proc.stdin?.end();
      this.proc.kill("SIGTERM");
    } catch {
      // already dead
    }
    this.proc = null;
    this.ready = false;
  }

  get isRunning(): boolean {
    return this.ready && this.proc !== null && this.proc.exitCode === null;
  }
}
