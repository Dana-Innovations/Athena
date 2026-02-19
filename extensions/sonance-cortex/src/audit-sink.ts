/**
 * Batched Audit Sink
 *
 * Collects audit events and flushes them to the Cortex API in batches.
 * Flush happens either when the batch is full or on a timer, whichever
 * comes first.
 */

import type { CortexClient } from "./cortex-client.js";

type AuditEvent = {
  userId?: string;
  sessionKey?: string;
  agentId?: string;
  toolName: string;
  toolCallId?: string;
  startedAt: number;
  durationMs?: number;
  success: boolean;
  error?: string;
  blocked?: boolean;
  /** Apollo key source used for the AI request (org, user_key, user_oauth). */
  keySource?: string;
};

export type AuditSinkConfig = {
  batchSize: number;
  flushIntervalMs: number;
};

export class AuditSink {
  private buffer: AuditEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private client: CortexClient;
  private config: AuditSinkConfig;
  private logger: { warn: (msg: string) => void };

  constructor(params: {
    client: CortexClient;
    config: AuditSinkConfig;
    logger: { warn: (msg: string) => void };
  }) {
    this.client = params.client;
    this.config = params.config;
    this.logger = params.logger;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  push(event: AuditEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    const batch = this.buffer.splice(0, this.config.batchSize);
    try {
      await this.client.pushAuditEvents({ events: batch });
    } catch (err) {
      this.logger.warn(
        `[sonance-cortex] audit flush failed (${batch.length} events): ${err instanceof Error ? err.message : String(err)}`,
      );
      // Re-queue failed events at the front (best-effort, may lose on crash).
      this.buffer.unshift(...batch);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
