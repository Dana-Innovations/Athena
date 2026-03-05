#!/usr/bin/env npx tsx
/**
 * Seed the local Athena platform database with sample data
 * so the admin portal has something to display.
 *
 * Usage: npx tsx scripts/seed-platform-db.ts
 */
import { resolve } from "node:path";
import { AthenaSqliteProvider } from "../src/platform/database/sqlite-provider.js";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const DB_PATH = resolve(ROOT, ".local-dev/athena.db");

const db = new AthenaSqliteProvider(DB_PATH);
db.initSchema();

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

// -- Conversations & Messages --
for (const agent of ["athena", "scheduler"]) {
  for (let i = 0; i < 5; i++) {
    const convId = db.createConversation({
      agentId: agent,
      userId: `user-${i + 1}`,
      userEmail: `user${i + 1}@sonance.com`,
      gateway: i % 2 === 0 ? "teams" : "web",
    });

    db.addMessage({
      conversationId: convId,
      agentId: agent,
      userId: `user-${i + 1}`,
      role: "user",
      content: `Hey ${agent}, can you help me with something?`,
    });

    db.addMessage({
      conversationId: convId,
      agentId: agent,
      userId: `user-${i + 1}`,
      role: "assistant",
      content: `Of course! I'm ${agent}, happy to help. What do you need?`,
      tokenCount: 42,
    });

    db.addMessage({
      conversationId: convId,
      agentId: agent,
      userId: `user-${i + 1}`,
      role: "user",
      content: `What meetings do I have today?`,
    });

    db.addMessage({
      conversationId: convId,
      agentId: agent,
      userId: `user-${i + 1}`,
      role: "assistant",
      content: `You have 3 meetings today:\n- 9:00 AM: Standup\n- 11:00 AM: Design Review\n- 2:00 PM: Sprint Planning`,
      toolCalls: [
        { name: "cortex_m365__list_events", args: { count: 10 }, result: { events: [] } },
      ],
      tokenCount: 128,
    });
  }
}

// -- Memory --
const memories = [
  {
    agent: "athena",
    user: "user-1",
    cat: "preference",
    topic: "meeting_style",
    content: "Prefers concise meeting summaries with action items listed at the top.",
  },
  {
    agent: "athena",
    user: "user-1",
    cat: "context",
    topic: "current_project",
    content: "Working on Project Phoenix — a CRM migration from Salesforce to HubSpot.",
  },
  {
    agent: "athena",
    user: "user-2",
    cat: "preference",
    topic: "communication_style",
    content: "Likes emoji in responses, informal tone.",
  },
  {
    agent: "athena",
    user: "user-2",
    cat: "fact",
    topic: "team",
    content: "Member of the Infrastructure team, reports to Elliott.",
  },
  {
    agent: "scheduler",
    user: "user-1",
    cat: "preference",
    topic: "scheduling",
    content: "Prefers meetings in the afternoon, never before 10 AM.",
  },
  {
    agent: "scheduler",
    user: "user-3",
    cat: "context",
    topic: "time_zone",
    content: "Based in PST (UTC-8).",
  },
  {
    agent: "athena",
    user: "user-3",
    cat: "fact",
    topic: "role",
    content: "VP of Engineering. Has access to all project repos.",
  },
];

for (const m of memories) {
  db.upsertMemory({
    agentId: m.agent,
    userId: m.user,
    category: m.cat,
    topic: m.topic,
    content: m.content,
    confidence: 0.8 + Math.random() * 0.2,
    source: "user_stated",
  });
}

// -- Usage Metrics --
for (const agent of ["athena", "scheduler"]) {
  for (const date of [yesterday, today]) {
    db.recordUsage({
      agentId: agent,
      date,
      conversations: 3 + Math.floor(Math.random() * 10),
      messages: 15 + Math.floor(Math.random() * 50),
      toolCalls: 5 + Math.floor(Math.random() * 20),
      tokensInput: 2000 + Math.floor(Math.random() * 5000),
      tokensOutput: 1000 + Math.floor(Math.random() * 3000),
      errors: Math.floor(Math.random() * 3),
      uniqueUsers: 2 + Math.floor(Math.random() * 5),
    });
  }
}

// -- Audit Events --
const auditEvents = [
  {
    type: "tool_call",
    agent: "athena",
    user: "user-1",
    action: "cortex_m365__list_events",
    details: { count: 10 },
  },
  {
    type: "tool_call",
    agent: "athena",
    user: "user-1",
    action: "cortex_m365__get_profile",
    details: {},
  },
  {
    type: "tool_call",
    agent: "scheduler",
    user: "user-2",
    action: "cortex_m365__list_events",
    details: { count: 5 },
  },
  {
    type: "agent_config_change",
    agent: "athena",
    user: "admin",
    action: "updated SOUL.md",
    details: { lines: 100 },
  },
  {
    type: "admin_action",
    agent: null,
    user: "admin",
    action: "restarted gateway",
    details: { reason: "config update" },
  },
  {
    type: "agent_message",
    agent: "athena",
    user: null,
    action: "delegated to scheduler",
    details: { topic: "calendar query" },
  },
];

for (const ev of auditEvents) {
  db.logAudit({
    eventType: ev.type,
    agentId: ev.agent ?? undefined,
    userId: ev.user ?? undefined,
    action: ev.action,
    details: ev.details,
  });
}

const stats = db.getTableStats();
console.log("\nSeeded platform database:");
for (const [table, count] of Object.entries(stats)) {
  console.log(`  ${table}: ${count} rows`);
}

db.close();
console.log("\nDone! Start the gateway to see data in the admin portal.");
