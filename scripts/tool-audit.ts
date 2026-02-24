#!/usr/bin/env bun
/**
 * Athena Tool Whitelist Audit
 *
 * Lists every tool in the OpenClaw runtime, shows its whitelist/deny status
 * under the current Sonance profile, and flags tools that need security review.
 *
 * Usage:
 *   bun scripts/tool-audit.ts              # interactive table
 *   bun scripts/tool-audit.ts --json       # machine-readable output
 *   bun scripts/tool-audit.ts --allow read # add tool to group:sonance allowlist
 *   bun scripts/tool-audit.ts --deny exec  # add tool to sonance deny list
 *   bun scripts/tool-audit.ts --review     # show only unreviewed tools
 */

import { TOOL_GROUPS } from "../src/agents/tool-policy.js";

// ── Risk classification for all known OpenClaw tools ──────────────────────────
// "critical": can execute code, write to filesystem, modify system state
// "high":     can send data externally or modify agent behavior
// "medium":   can read sensitive data or spawn sub-processes
// "low":      read-only informational tools
// "safe":     passive, no side effects

type RiskLevel = "critical" | "high" | "medium" | "low" | "safe";

interface ToolEntry {
  name: string;
  category: string;
  risk: RiskLevel;
  description: string;
  concerns: string[];
}

const TOOL_CATALOG: ToolEntry[] = [
  // ── Filesystem / Code tools ─────────────────────────────────────────────────
  {
    name: "read",
    category: "filesystem",
    risk: "low",
    description: "Read file contents from workspace",
    concerns: ["Can read config files containing secrets if workspace is broad"],
  },
  {
    name: "write",
    category: "filesystem",
    risk: "critical",
    description: "Write/create files on the filesystem",
    concerns: [
      "Arbitrary file creation",
      "Could overwrite critical configs",
      "Code injection vector",
    ],
  },
  {
    name: "edit",
    category: "filesystem",
    risk: "critical",
    description: "Edit existing files (find & replace)",
    concerns: ["Can modify any file the agent can access", "Could alter security-sensitive code"],
  },
  {
    name: "apply_patch",
    category: "filesystem",
    risk: "critical",
    description: "Apply unified diff patches to files",
    concerns: ["Same risks as write/edit", "Bulk file modification"],
  },
  // ── Runtime / Execution tools ───────────────────────────────────────────────
  {
    name: "exec",
    category: "runtime",
    risk: "critical",
    description: "Execute shell commands on the host",
    concerns: [
      "Arbitrary command execution",
      "Network access",
      "System modification",
      "Data exfiltration",
    ],
  },
  {
    name: "process",
    category: "runtime",
    risk: "critical",
    description: "Manage background processes (list, kill, send input)",
    concerns: ["Can kill system processes", "Can interact with running services"],
  },
  // ── Web tools ───────────────────────────────────────────────────────────────
  {
    name: "web_search",
    category: "web",
    risk: "medium",
    description: "Search the web via Brave/Perplexity/Grok",
    concerns: ["Sends queries to external APIs", "Could leak context in search terms"],
  },
  {
    name: "web_fetch",
    category: "web",
    risk: "medium",
    description: "Fetch and parse web page content",
    concerns: ["Outbound network requests", "Could fetch malicious content", "SSRF potential"],
  },
  // ── Messaging tools ─────────────────────────────────────────────────────────
  {
    name: "message",
    category: "messaging",
    risk: "high",
    description: "Send messages to channels/users",
    concerns: [
      "Can send data to external messaging platforms",
      "Social engineering vector",
      "Data exfiltration via messages",
    ],
  },
  // ── Session tools ───────────────────────────────────────────────────────────
  {
    name: "sessions_list",
    category: "sessions",
    risk: "low",
    description: "List active agent sessions",
    concerns: ["Reveals session metadata"],
  },
  {
    name: "sessions_history",
    category: "sessions",
    risk: "low",
    description: "Read session conversation history",
    concerns: ["Can read other sessions' data depending on visibility config"],
  },
  {
    name: "sessions_send",
    category: "sessions",
    risk: "high",
    description: "Send a message to another session",
    concerns: ["Cross-session communication", "Could inject prompts into other sessions"],
  },
  {
    name: "sessions_spawn",
    category: "sessions",
    risk: "high",
    description: "Spawn a new sub-agent session",
    concerns: ["Creates autonomous sub-agents", "Resource consumption", "Privilege escalation"],
  },
  {
    name: "subagents",
    category: "sessions",
    risk: "medium",
    description: "List/manage spawned sub-agent sessions",
    concerns: ["Visibility into sub-agent tree"],
  },
  {
    name: "session_status",
    category: "sessions",
    risk: "safe",
    description: "Show current session status and metadata",
    concerns: [],
  },
  // ── UI tools ────────────────────────────────────────────────────────────────
  {
    name: "browser",
    category: "ui",
    risk: "critical",
    description: "Control a headless browser (navigate, click, type)",
    concerns: [
      "Full browser automation",
      "Can access any URL",
      "Credential theft via form interaction",
      "Arbitrary web requests",
    ],
  },
  {
    name: "canvas",
    category: "ui",
    risk: "medium",
    description: "Render HTML/React UI canvases",
    concerns: ["Client-side code execution in canvas context"],
  },
  // ── Infrastructure tools ────────────────────────────────────────────────────
  {
    name: "cron",
    category: "automation",
    risk: "high",
    description: "Create/manage scheduled tasks",
    concerns: ["Persistent autonomous execution", "Can schedule arbitrary tool calls"],
  },
  {
    name: "gateway",
    category: "automation",
    risk: "high",
    description: "Control the gateway server (restart, config)",
    concerns: ["Can modify server configuration", "Service disruption"],
  },
  {
    name: "nodes",
    category: "automation",
    risk: "high",
    description: "Manage remote node connections",
    concerns: ["Remote command execution", "Network pivot point"],
  },
  // ── Informational tools ─────────────────────────────────────────────────────
  {
    name: "agents_list",
    category: "info",
    risk: "safe",
    description: "List configured agents",
    concerns: [],
  },
  {
    name: "image",
    category: "media",
    risk: "low",
    description: "Generate images via AI models",
    concerns: ["Sends prompts to external image APIs", "Cost implications"],
  },
  {
    name: "tts",
    category: "media",
    risk: "low",
    description: "Text-to-speech synthesis",
    concerns: ["Sends text to external TTS APIs"],
  },
  // ── Memory tools ────────────────────────────────────────────────────────────
  {
    name: "memory_search",
    category: "memory",
    risk: "low",
    description: "Search vector memory store",
    concerns: ["Can surface any indexed content"],
  },
  {
    name: "memory_get",
    category: "memory",
    risk: "low",
    description: "Retrieve specific memory entries",
    concerns: ["Direct memory access"],
  },
];

// ── Resolve current whitelist state ───────────────────────────────────────────

const sonanceAllowed = new Set(TOOL_GROUPS["group:sonance"] ?? []);
const sonanceProfile = {
  allow: TOOL_GROUPS["group:sonance"] ?? [],
  deny: [
    "exec",
    "process",
    "write",
    "edit",
    "apply_patch",
    "gateway",
    "nodes",
    "sessions_spawn",
    "sessions_send",
    "whatsapp_login",
    "cron",
    "browser",
  ],
};
const sonanceDenied = new Set(sonanceProfile.deny);

type ToolStatus = "allowed" | "denied" | "unreviewed";

function getToolStatus(name: string): ToolStatus {
  if (sonanceDenied.has(name)) {
    return "denied";
  }
  if (sonanceAllowed.has(name)) {
    return "allowed";
  }
  return "unreviewed";
}

function statusIcon(status: ToolStatus): string {
  switch (status) {
    case "allowed":
      return "\x1b[32m✓ ALLOWED \x1b[0m";
    case "denied":
      return "\x1b[31m✗ DENIED  \x1b[0m";
    case "unreviewed":
      return "\x1b[33m? UNREVIEWED\x1b[0m";
  }
}

function riskColor(risk: RiskLevel): string {
  const colors: Record<RiskLevel, string> = {
    critical: "\x1b[31;1m",
    high: "\x1b[31m",
    medium: "\x1b[33m",
    low: "\x1b[36m",
    safe: "\x1b[32m",
  };
  return `${colors[risk]}${risk.toUpperCase().padEnd(8)}\x1b[0m`;
}

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const reviewMode = args.includes("--review");
const allowIdx = args.indexOf("--allow");
const denyIdx = args.indexOf("--deny");

if (allowIdx !== -1 || denyIdx !== -1) {
  const isAllow = allowIdx !== -1;
  const toolName = args[(isAllow ? allowIdx : denyIdx) + 1];
  if (!toolName) {
    console.error(`Usage: tool-audit.ts --${isAllow ? "allow" : "deny"} <tool_name>`);
    process.exit(1);
  }

  const entry = TOOL_CATALOG.find((t) => t.name === toolName);
  if (!entry) {
    console.error(`Unknown tool: ${toolName}`);
    console.error(`Known tools: ${TOOL_CATALOG.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  const file = "src/agents/tool-policy.ts";
  console.log(`\nTo ${isAllow ? "allow" : "deny"} "${toolName}":`);
  console.log(`  1. Edit ${file}`);
  if (isAllow) {
    console.log(`  2. Add "${toolName}" to TOOL_GROUPS["group:sonance"]`);
    console.log(`  3. Remove "${toolName}" from TOOL_PROFILES.sonance.deny (if present)`);
  } else {
    console.log(`  2. Add "${toolName}" to TOOL_PROFILES.sonance.deny`);
    console.log(`  3. Remove "${toolName}" from TOOL_GROUPS["group:sonance"] (if present)`);
  }
  console.log(`  4. Run: bun scripts/tool-audit.ts  (to verify)`);
  console.log(`  5. Document the decision in docs/sonance/tool-reviews/<tool>.md\n`);
  console.log(`Tool details:`);
  console.log(`  Risk:     ${entry.risk.toUpperCase()}`);
  console.log(`  Category: ${entry.category}`);
  console.log(
    `  Concerns: ${entry.concerns.length > 0 ? entry.concerns.join("; ") : "None identified"}`,
  );
  process.exit(0);
}

// ── Output ────────────────────────────────────────────────────────────────────

const catalog = reviewMode
  ? TOOL_CATALOG.filter((t) => getToolStatus(t.name) === "unreviewed")
  : TOOL_CATALOG;

if (jsonMode) {
  const output = catalog.map((tool) => ({
    ...tool,
    status: getToolStatus(tool.name),
  }));
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

console.log("\n\x1b[1m═══════════════════════════════════════════════════════════════════\x1b[0m");
console.log("\x1b[1m  Athena Tool Whitelist Audit — Sonance Profile\x1b[0m");
console.log("\x1b[1m═══════════════════════════════════════════════════════════════════\x1b[0m\n");

const summary = { allowed: 0, denied: 0, unreviewed: 0 };

const grouped = new Map<string, ToolEntry[]>();
for (const tool of catalog) {
  const list = grouped.get(tool.category) ?? [];
  list.push(tool);
  grouped.set(tool.category, list);
}

for (const [category, tools] of grouped) {
  console.log(`\x1b[1;4m${category.toUpperCase()}\x1b[0m`);
  for (const tool of tools) {
    const status = getToolStatus(tool.name);
    summary[status]++;
    console.log(
      `  ${statusIcon(status)}  ${riskColor(tool.risk)}  ${tool.name.padEnd(20)} ${tool.description}`,
    );
    if (tool.concerns.length > 0 && (status === "unreviewed" || reviewMode)) {
      for (const concern of tool.concerns) {
        console.log(`                                              \x1b[2m⚠ ${concern}\x1b[0m`);
      }
    }
  }
  console.log();
}

console.log("\x1b[1m───────────────────────────────────────────────────────────────────\x1b[0m");
console.log(
  `  \x1b[32m✓ Allowed: ${summary.allowed}\x1b[0m  |  ` +
    `\x1b[31m✗ Denied: ${summary.denied}\x1b[0m  |  ` +
    `\x1b[33m? Unreviewed: ${summary.unreviewed}\x1b[0m`,
);
console.log("\x1b[1m───────────────────────────────────────────────────────────────────\x1b[0m");

if (summary.unreviewed > 0) {
  console.log(
    `\n\x1b[33mAction required:\x1b[0m ${summary.unreviewed} tool(s) have not been security-reviewed.`,
  );
  console.log("Run with --review to see only unreviewed tools.");
  console.log("See: .agent/workflows/tool-security-review.md for the review process.\n");
}

console.log(
  `Config: src/agents/tool-policy.ts (TOOL_GROUPS["group:sonance"] + TOOL_PROFILES.sonance)`,
);
console.log(`Docs:   docs/sonance/tool-reviews/\n`);
