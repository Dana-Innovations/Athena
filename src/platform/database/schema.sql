-- Athena Platform Database Schema
-- Target: Supabase (Postgres) for production, SQLite for local development
-- Version: 1.0
--
-- This schema supports both Postgres and SQLite.
-- Postgres-specific features (GIN indexes, gen_random_uuid) are guarded
-- with comments; the SQLite provider creates equivalent tables with
-- TEXT primary keys and application-generated UUIDs.

-- Conversations: one row per user↔agent conversation session
CREATE TABLE IF NOT EXISTS agent_conversations (
    id              TEXT PRIMARY KEY,                 -- UUID (app-generated for SQLite)
    agent_id        TEXT NOT NULL,                    -- "athena", "scheduler"
    user_id         TEXT NOT NULL,                    -- Cortex/SSO user ID
    user_email      TEXT,                             -- josh@sonance.com
    gateway         TEXT NOT NULL,                    -- "teams", "web", "api"
    started_at      TEXT NOT NULL,                    -- ISO 8601 timestamp
    last_message_at TEXT NOT NULL,                    -- ISO 8601 timestamp
    message_count   INTEGER NOT NULL DEFAULT 0,
    token_usage     TEXT DEFAULT '{}',               -- JSON: {input: N, output: N}
    metadata        TEXT DEFAULT '{}',               -- JSON: gateway-specific data
    created_at      TEXT NOT NULL                     -- ISO 8601 timestamp
);

CREATE INDEX IF NOT EXISTS idx_conversations_agent
    ON agent_conversations(agent_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON agent_conversations(user_id, last_message_at);

-- Messages: individual messages within conversations
CREATE TABLE IF NOT EXISTS agent_messages (
    id              TEXT PRIMARY KEY,                 -- UUID
    conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    agent_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    role            TEXT NOT NULL,                    -- "user", "assistant", "tool"
    content         TEXT NOT NULL,
    tool_calls      TEXT,                             -- JSON: [{name, args, result}]
    token_count     INTEGER,
    created_at      TEXT NOT NULL                     -- ISO 8601 timestamp
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON agent_messages(conversation_id, created_at);

-- Structured user memory: queryable by topic, agent, date
CREATE TABLE IF NOT EXISTS agent_memory (
    id              TEXT PRIMARY KEY,                 -- UUID
    agent_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    category        TEXT NOT NULL,                    -- "preference", "context", "fact"
    topic           TEXT NOT NULL,                    -- "meeting_style", "project_x", "team"
    content         TEXT NOT NULL,
    confidence      REAL DEFAULT 1.0,                -- 0-1
    source          TEXT,                             -- "user_stated", "inferred", "tool_result"
    last_accessed   TEXT,                             -- ISO 8601 timestamp
    expires_at      TEXT,                             -- ISO 8601 timestamp (optional TTL)
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_unique
    ON agent_memory(agent_id, user_id, topic);
CREATE INDEX IF NOT EXISTS idx_memory_agent_user
    ON agent_memory(agent_id, user_id);

-- Usage metrics: aggregated per agent per day
CREATE TABLE IF NOT EXISTS usage_metrics (
    id              TEXT PRIMARY KEY,                 -- UUID
    agent_id        TEXT NOT NULL,
    date            TEXT NOT NULL,                    -- YYYY-MM-DD
    conversations   INTEGER NOT NULL DEFAULT 0,
    messages        INTEGER NOT NULL DEFAULT 0,
    tool_calls      INTEGER NOT NULL DEFAULT 0,
    tokens_input    INTEGER NOT NULL DEFAULT 0,
    tokens_output   INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms  INTEGER,
    unique_users    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique
    ON usage_metrics(agent_id, date);

-- Cron job definitions
CREATE TABLE IF NOT EXISTS cron_jobs (
    id              TEXT PRIMARY KEY,                 -- UUID
    agent_id        TEXT NOT NULL,
    name            TEXT NOT NULL,
    schedule        TEXT NOT NULL,                    -- Cron expression
    action          TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,      -- SQLite boolean: 0/1
    last_run_at     TEXT,
    next_run_at     TEXT,
    created_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_unique
    ON cron_jobs(agent_id, name);

-- Cron run history
CREATE TABLE IF NOT EXISTS cron_runs (
    id              TEXT PRIMARY KEY,                 -- UUID
    job_id          TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'running',  -- "running", "success", "failed"
    result          TEXT,                             -- JSON
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job
    ON cron_runs(job_id, started_at);

-- Audit trail
CREATE TABLE IF NOT EXISTS audit_events (
    id              TEXT PRIMARY KEY,                 -- UUID
    event_type      TEXT NOT NULL,                    -- "tool_call", "agent_config_change", "agent_message", "admin_action"
    agent_id        TEXT,
    user_id         TEXT,
    action          TEXT NOT NULL,
    details         TEXT,                             -- JSON (sensitive values redacted)
    ip_address      TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_agent
    ON audit_events(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_type
    ON audit_events(event_type, created_at);

-- Agent error events: one row per discrete error (tool failure, API error, runtime exception)
CREATE TABLE IF NOT EXISTS agent_error_events (
    id              TEXT PRIMARY KEY,                 -- UUID
    agent_id        TEXT NOT NULL,
    conversation_id TEXT REFERENCES agent_conversations(id) ON DELETE SET NULL,
    user_id         TEXT,
    error_type      TEXT NOT NULL,                    -- 'tool_error' | 'api_error' | 'runtime_error'
    error_message   TEXT,                             -- human-readable error text
    tool_name       TEXT,                             -- set when error_type = 'tool_error'
    details         TEXT,                             -- JSON: additional context
    created_at      TEXT NOT NULL                     -- ISO 8601 timestamp
);

CREATE INDEX IF NOT EXISTS idx_error_events_agent
    ON agent_error_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_conv
    ON agent_error_events(conversation_id, created_at DESC);

-- Agent health: one row per agent turn — tracks latency and status
CREATE TABLE IF NOT EXISTS agent_health (
    id                  TEXT PRIMARY KEY,             -- UUID
    agent_id            TEXT NOT NULL,
    conversation_id     TEXT REFERENCES agent_conversations(id) ON DELETE SET NULL,
    user_id             TEXT,
    turn_duration_ms    INTEGER NOT NULL,             -- total time from request to response
    response_latency_ms INTEGER,                      -- time to first token (optional)
    status              TEXT NOT NULL DEFAULT 'success',  -- 'success' | 'error' | 'timeout'
    error_code          TEXT,                         -- null if success
    tokens_input        INTEGER,
    tokens_output       INTEGER,
    model               TEXT,
    created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_agent
    ON agent_health(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_status
    ON agent_health(agent_id, status, created_at DESC);

-- SOUL.md version history: immutable audit trail of every saved SOUL.md
CREATE TABLE IF NOT EXISTS agent_soul_versions (
    id          TEXT PRIMARY KEY,                      -- UUID
    agent_id    TEXT NOT NULL,
    version     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_by  TEXT,                                  -- user_id or 'system'
    created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_soul_versions_unique
    ON agent_soul_versions(agent_id, version);
CREATE INDEX IF NOT EXISTS idx_soul_versions_agent
    ON agent_soul_versions(agent_id, version DESC);
