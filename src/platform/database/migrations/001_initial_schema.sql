-- Athena Platform — Supabase (Postgres) Migration: Initial Schema
-- Run this against your Supabase project to create the platform tables.
-- Compatible with the SQLite schema in ../schema.sql.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS agent_conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    user_email      TEXT,
    gateway         TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    message_count   INTEGER NOT NULL DEFAULT 0,
    token_usage     JSONB DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_agent
    ON agent_conversations(agent_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON agent_conversations(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    agent_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content         TEXT NOT NULL,
    tool_calls      JSONB,
    token_count     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON agent_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_content_gin
    ON agent_messages USING gin (to_tsvector('english', content));

CREATE TABLE IF NOT EXISTS agent_memory (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    category        TEXT NOT NULL CHECK (category IN ('preference', 'context', 'fact')),
    topic           TEXT NOT NULL,
    content         TEXT NOT NULL,
    confidence      REAL DEFAULT 1.0,
    source          TEXT,
    last_accessed   TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_unique
    ON agent_memory(agent_id, user_id, topic);
CREATE INDEX IF NOT EXISTS idx_memory_agent_user
    ON agent_memory(agent_id, user_id);

CREATE TABLE IF NOT EXISTS usage_metrics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        TEXT NOT NULL,
    date            DATE NOT NULL,
    conversations   INTEGER NOT NULL DEFAULT 0,
    messages        INTEGER NOT NULL DEFAULT 0,
    tool_calls      INTEGER NOT NULL DEFAULT 0,
    tokens_input    INTEGER NOT NULL DEFAULT 0,
    tokens_output   INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms  INTEGER,
    unique_users    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique
    ON usage_metrics(agent_id, date);

CREATE TABLE IF NOT EXISTS cron_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        TEXT NOT NULL,
    name            TEXT NOT NULL,
    schedule        TEXT NOT NULL,
    action          TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_unique
    ON cron_jobs(agent_id, name);

CREATE TABLE IF NOT EXISTS cron_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
    result          JSONB,
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job
    ON cron_runs(job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type      TEXT NOT NULL,
    agent_id        TEXT,
    user_id         TEXT,
    action          TEXT NOT NULL,
    details         JSONB,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_agent
    ON audit_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type
    ON audit_events(event_type, created_at DESC);

-- Agent error events: one row per discrete error (tool failure, API error, runtime exception)
CREATE TABLE IF NOT EXISTS agent_error_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        TEXT NOT NULL,
    conversation_id UUID REFERENCES agent_conversations(id) ON DELETE SET NULL,
    user_id         TEXT,
    error_type      TEXT NOT NULL,                    -- 'tool_error' | 'api_error' | 'runtime_error'
    error_message   TEXT,
    tool_name       TEXT,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_events_agent
    ON agent_error_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_conv
    ON agent_error_events(conversation_id, created_at DESC);

-- Agent health: one row per agent turn — tracks latency and status
CREATE TABLE IF NOT EXISTS agent_health (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id            TEXT NOT NULL,
    conversation_id     UUID REFERENCES agent_conversations(id) ON DELETE SET NULL,
    user_id             TEXT,
    turn_duration_ms    INTEGER NOT NULL,
    response_latency_ms INTEGER,
    status              TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'timeout')),
    error_code          TEXT,
    tokens_input        INTEGER,
    tokens_output       INTEGER,
    model               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_agent
    ON agent_health(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_status
    ON agent_health(agent_id, status, created_at DESC);

-- Roundtable sessions: one row per multi-agent fan-out session
CREATE TABLE IF NOT EXISTS roundtable_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      TEXT NOT NULL UNIQUE,          -- rt_N_timestamp internal ID
    user_id         TEXT NOT NULL,
    message         TEXT NOT NULL,
    participants    JSONB NOT NULL DEFAULT '[]',   -- [{agentId, displayName}]
    responses       JSONB NOT NULL DEFAULT '[]',   -- [{agentId, displayName, text, durationMs, error?}]
    total_duration_ms INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roundtable_user
    ON roundtable_sessions(user_id, created_at DESC);

-- SOUL.md version history: immutable audit trail of every saved SOUL.md
CREATE TABLE IF NOT EXISTS agent_soul_versions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id    TEXT NOT NULL,
    version     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_by  TEXT,                                   -- user_id or 'system' for auto-seeded
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_soul_versions_unique
    ON agent_soul_versions(agent_id, version);
CREATE INDEX IF NOT EXISTS idx_soul_versions_agent
    ON agent_soul_versions(agent_id, version DESC);

-- RLS policies (enable when ready)
-- ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Helper function for atomic message count increment
CREATE OR REPLACE FUNCTION increment_conversation_messages(conv_id UUID, ts TIMESTAMPTZ)
RETURNS void AS $$
BEGIN
  UPDATE agent_conversations
  SET message_count = message_count + 1,
      last_message_at = ts
  WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;

-- Helper function for atomic usage metrics increment
CREATE OR REPLACE FUNCTION increment_usage_metrics(
  metric_id UUID,
  add_conversations INTEGER DEFAULT 0,
  add_messages INTEGER DEFAULT 0,
  add_tool_calls INTEGER DEFAULT 0,
  add_tokens_input INTEGER DEFAULT 0,
  add_tokens_output INTEGER DEFAULT 0,
  add_errors INTEGER DEFAULT 0
)
RETURNS void AS $$
BEGIN
  UPDATE usage_metrics
  SET conversations = conversations + add_conversations,
      messages = messages + add_messages,
      tool_calls = tool_calls + add_tool_calls,
      tokens_input = tokens_input + add_tokens_input,
      tokens_output = tokens_output + add_tokens_output,
      errors = errors + add_errors
  WHERE id = metric_id;
END;
$$ LANGUAGE plpgsql;
