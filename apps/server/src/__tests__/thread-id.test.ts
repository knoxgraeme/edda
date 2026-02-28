import { describe, it, expect } from "vitest";
import type { Agent } from "@edda/db";
import { resolveThreadId } from "../agent/build-agent.js";

describe("resolveThreadId", () => {
  it("falls back to UTC date when timezone is invalid", () => {
    const fixedNow = new Date("2026-02-27T12:34:56.000Z");
    const agent = {
      name: "reviewer",
      thread_lifetime: "daily",
      thread_scope: "per_agent",
    } as unknown as Agent;

    const threadId = resolveThreadId(agent, undefined, {
      now: fixedNow,
      timezone: "Mars/Phobos",
    });

    expect(threadId).toBe("task-reviewer-2026-02-27");
  });
});
