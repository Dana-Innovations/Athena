import { describe, it, expect, beforeEach } from "vitest";
import { AgentMessageBus } from "./message-bus.js";

describe("AgentMessageBus", () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
  });

  it("query returns reply from handler", async () => {
    bus.subscribe("scheduler", async (msg) => ({
      id: "reply-1",
      inReplyTo: msg.id,
      from: "scheduler",
      to: msg.from,
      payload: { nextSlot: "2026-03-05T10:00:00Z" },
      timestamp: Date.now(),
    }));

    const reply = await bus.query("athena", "scheduler", { action: "find-slot" });
    expect(reply.from).toBe("scheduler");
    expect(reply.payload.nextSlot).toBe("2026-03-05T10:00:00Z");
  });

  it("query times out when handler never replies", async () => {
    bus.subscribe("slow", async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return undefined;
    });

    await expect(
      bus.query("athena", "slow", { action: "wait" }, { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/);
  });

  it("throws when target agent is not registered", async () => {
    await expect(bus.query("athena", "ghost", {})).rejects.toThrow(/not registered/);
  });

  it("enforces ACL: blocks unauthorized contact", async () => {
    bus.subscribe("scheduler", async () => undefined);
    bus.setAcl("athena", ["ops"]);

    await expect(bus.query("athena", "scheduler", {})).rejects.toThrow(/not allowed to contact/);
  });

  it("ACL wildcard allows any target", async () => {
    bus.subscribe("scheduler", async (msg) => ({
      id: "r",
      inReplyTo: msg.id,
      from: "scheduler",
      to: msg.from,
      payload: {},
      timestamp: Date.now(),
    }));
    bus.setAcl("athena", ["*"]);

    const reply = await bus.query("athena", "scheduler", {});
    expect(reply.from).toBe("scheduler");
  });

  it("notify does not block or return a reply", async () => {
    const received: string[] = [];
    bus.subscribe("analyst", async (msg) => {
      received.push(msg.type);
    });

    await bus.notify("ops", "analyst", { event: "data_ready" });
    // Give the async handler a tick to run
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual(["notify"]);
  });

  it("message log records all messages", async () => {
    bus.subscribe("scheduler", async (msg) => ({
      id: "r",
      inReplyTo: msg.id,
      from: "scheduler",
      to: "athena",
      payload: { ok: true },
      timestamp: Date.now(),
    }));

    await bus.query("athena", "scheduler", { q: "when?" });
    const log = bus.getLog();
    expect(log.length).toBe(2);
    expect(log[0].from).toBe("athena");
    expect(log[1].from).toBe("scheduler");
  });

  it("listAgents returns registered agent IDs", () => {
    bus.subscribe("a", async () => undefined);
    bus.subscribe("b", async () => undefined);
    expect(bus.listAgents().toSorted()).toEqual(["a", "b"]);
  });
});
