/**
 * Sonance Tool-Call Audit Logger
 *
 * Records every tool invocation with caller identity, timing, and outcome.
 * Designed for integration with the Sonance Cortex billing/security pipeline.
 *
 * Current implementation writes structured JSON lines to the subsystem log.
 * Phase 3 will replace the sink with a Cortex API push via the sonance-cortex
 * plugin; the event shape is intentionally stable so downstream consumers can
 * rely on it across that migration.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("security/audit");

export type SonanceAuditEvent = {
  /** Sonance user id (populated after Phase 2 SSO integration). */
  userId?: string;
  /** OpenClaw session key. */
  sessionKey?: string;
  /** Agent id that owns the session. */
  agentId?: string;
  /** Canonical tool name. */
  toolName: string;
  /** Unique tool-call id assigned by the model. */
  toolCallId?: string;
  /** Unix epoch millis when the call started. */
  startedAt: number;
  /** Wall-clock duration in milliseconds (set after completion). */
  durationMs?: number;
  /** Whether the tool call succeeded. */
  success: boolean;
  /** Error message if the call failed or was blocked. */
  error?: string;
  /** Whether the call was blocked before execution (policy / hook). */
  blocked?: boolean;
};

/**
 * Emit an audit event. Currently logs to the subsystem logger as structured
 * JSON. The Cortex plugin (Phase 3) will register a replacement sink via
 * {@link setSonanceAuditSink}.
 */
export function emitAuditEvent(event: SonanceAuditEvent): void {
  if (auditSink) {
    try {
      auditSink(event);
    } catch {
      // Sink errors must never break the tool-call path.
    }
  }

  const level = event.blocked || !event.success ? "warn" : "info";
  log[level]("tool_call_audit", event as unknown as Record<string, unknown>);
}

export type SonanceAuditSink = (event: SonanceAuditEvent) => void;

let auditSink: SonanceAuditSink | undefined;

/**
 * Register an external audit sink (e.g. Cortex plugin push).
 * Returns a teardown function that restores the previous sink.
 */
export function setSonanceAuditSink(sink: SonanceAuditSink): () => void {
  const previous = auditSink;
  auditSink = sink;
  return () => {
    auditSink = previous;
  };
}
