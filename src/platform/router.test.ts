import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { resolveAgentFromMessage, handleAgentsListCommand } from "./router.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "../..");

describe("resolveAgentFromMessage — intent routing", () => {
  it("routes scheduling messages to scheduler", () => {
    const result = resolveAgentFromMessage(
      "schedule a meeting with Josh tomorrow",
      "user-1",
      REPO_ROOT,
    );
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("scheduler");
    expect(result!.matchedBy).toBe("intent");
    expect(result!.strippedBody).toBe("schedule a meeting with Josh tomorrow");
  });

  it("routes calendar queries to scheduler", () => {
    const result = resolveAgentFromMessage("what's on my calendar today?", "user-1", REPO_ROOT);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("scheduler");
    expect(result!.matchedBy).toBe("intent");
  });

  it("routes availability checks to scheduler", () => {
    const result = resolveAgentFromMessage(
      "when is Elliott available this week?",
      "user-1",
      REPO_ROOT,
    );
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("scheduler");
  });

  it("routes meeting requests to scheduler", () => {
    const result = resolveAgentFromMessage(
      "book a 30 min sync with the design team",
      "user-1",
      REPO_ROOT,
    );
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("scheduler");
  });

  it("routes non-scheduling messages to athena (default)", () => {
    const result = resolveAgentFromMessage("summarize my latest emails", "user-1", REPO_ROOT);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("athena");
    expect(result!.matchedBy).toBe("default");
  });

  it("routes general questions to athena (default)", () => {
    const result = resolveAgentFromMessage("hello, how are you?", "user-1", REPO_ROOT);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("athena");
    expect(result!.matchedBy).toBe("default");
  });

  it("routes 'what do i have today' to scheduler", () => {
    const result = resolveAgentFromMessage("what do i have today", "user-1", REPO_ROOT);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("scheduler");
  });

  it("routes 'find time for a 1:1' to scheduler", () => {
    const result = resolveAgentFromMessage(
      "find time for a 1:1 with Sarah next week",
      "user-1",
      REPO_ROOT,
    );
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("scheduler");
  });
});

describe("resolveAgentFromMessage — explicit prefix override", () => {
  it("!scheduler routes to scheduler with stripped body", () => {
    const result = resolveAgentFromMessage("!scheduler find me a slot", "user-1", REPO_ROOT);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("scheduler");
    expect(result!.matchedBy).toBe("command");
    expect(result!.strippedBody).toBe("find me a slot");
  });

  it("@athena routes to athena with stripped body", () => {
    const result = resolveAgentFromMessage("@athena how is my day?", "user-1", REPO_ROOT);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("athena");
    expect(result!.matchedBy).toBe("command");
    expect(result!.strippedBody).toBe("how is my day?");
  });

  it("unknown prefix falls through to intent/default", () => {
    const result = resolveAgentFromMessage("!unknown do something", "user-1", REPO_ROOT);
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("athena");
    expect(result!.matchedBy).toBe("default");
  });
});

describe("handleAgentsListCommand", () => {
  it("lists both agents with routing info", () => {
    const output = handleAgentsListCommand(REPO_ROOT);
    expect(output).toContain("Athena");
    expect(output).toContain("Scheduler");
    expect(output).toContain("automatically routed");
    expect(output).toContain("schedule");
  });
});
