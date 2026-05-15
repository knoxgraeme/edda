import { describe, it, expect } from "vitest";
import type { Agent } from "../../../types/db";
import { AVAILABLE_SKILLS, AVAILABLE_TOOL_GROUPS } from "../../constants";
import { allOptions, currentSelection } from "./capability-editor-helpers";

function makeAgent(
  overrides: Partial<Pick<Agent, "skills" | "tools" | "subagents">> = {},
): Agent {
  return {
    id: "test-id",
    name: "test_agent",
    description: "",
    system_prompt: null,
    skills: [],
    tools: [],
    subagents: [],
    thread_lifetime: "persistent",
    thread_scope: "shared",
    trigger: null,
    model_provider: null,
    model: null,
    enabled: true,
    memory_capture: false,
    memory_self_reflect: false,
    metadata: {},
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("allOptions", () => {
  it("returns all AVAILABLE_SKILLS names for kind=skills", () => {
    const agent = makeAgent();
    const result = allOptions("skills", agent, []);
    expect(result).toEqual(AVAILABLE_SKILLS.map((s) => s.name));
    expect(result.length).toBeGreaterThan(0);
  });

  it("appends unknown custom tools after the known set for kind=tools", () => {
    const known = AVAILABLE_TOOL_GROUPS[0].tools[0];
    const custom = "unknown_custom_tool";
    const agent = makeAgent({ tools: [known, custom] });
    const result = allOptions("tools", agent, []);
    const knownTools = AVAILABLE_TOOL_GROUPS.flatMap((g) => g.tools);

    expect(result.slice(0, knownTools.length)).toEqual(knownTools);
    expect(result[result.length - 1]).toBe(custom);
  });

  it("does not duplicate a known tool as unknown for kind=tools", () => {
    const known = AVAILABLE_TOOL_GROUPS[0].tools[0];
    const agent = makeAgent({ tools: [known] });
    const result = allOptions("tools", agent, []);
    const knownTools = AVAILABLE_TOOL_GROUPS.flatMap((g) => g.tools);
    expect(result.length).toBe(knownTools.length);
  });

  it("returns availableAgents for kind=subagents", () => {
    const agent = makeAgent();
    const available = ["agent_a", "agent_b"];
    expect(allOptions("subagents", agent, available)).toEqual(available);
  });
});

describe("currentSelection", () => {
  it("returns agent.skills for kind=skills", () => {
    expect(currentSelection("skills", makeAgent({ skills: ["admin", "capture"] }))).toEqual([
      "admin",
      "capture",
    ]);
  });

  it("returns agent.tools for kind=tools", () => {
    expect(
      currentSelection("tools", makeAgent({ tools: ["create_item", "search_items"] })),
    ).toEqual(["create_item", "search_items"]);
  });

  it("returns agent.subagents for kind=subagents", () => {
    expect(currentSelection("subagents", makeAgent({ subagents: ["digest"] }))).toEqual(["digest"]);
  });
});
