/**
 * Prompt builder tests — three-layer system prompt structure.
 *
 * Tests buildPrompt() from build-agent.ts which assembles:
 * Layer 1: Agent prompt (task description)
 * Layer 2: Memory (AGENTS.md content)
 * Layer 3: System context (capabilities, rules, context)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";
import type { Agent, Settings } from "@edda/db";

// Use vi.hoisted() so these mocks are available inside vi.mock() factories
const { mockGetAgentsMdContent } = vi.hoisted(() => {
  return {
    mockGetAgentsMdContent: vi.fn().mockResolvedValue(""),
  };
});

vi.mock("@edda/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAgentsMdContent: mockGetAgentsMdContent,
  };
});

import { buildPrompt } from "../agent/build-agent.js";

/** Minimal agent fixture — buildPrompt only reads a few fields */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "test-id",
    name: "test_agent",
    description: "A test agent",
    system_prompt: null,
    skills: [],
    thread_lifetime: "ephemeral",
    trigger: "on_demand",
    tools: [],
    subagents: [],
    model_provider: null,
    model: null,
    enabled: true,
    memory_capture: true,
    memory_self_reflect: true,
    thread_scope: "shared",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const settings: Settings = { ...DEFAULT_TEST_SETTINGS, default_agent: "edda" };

describe("buildPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentsMdContent.mockResolvedValue("");
  });

  // ── Layer 1: Agent prompt ──

  it("uses agent system_prompt as base when provided", async () => {
    const agent = makeAgent({ system_prompt: "You are a custom agent." });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("You are a custom agent.");
  });

  it("uses default base prompt when system_prompt is null", async () => {
    const agent = makeAgent({ name: "my_agent", system_prompt: null });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("You are my_agent, an Edda agent.");
  });

  // ── Layer 2: Memory ──

  it("includes AGENTS.md content in agent_memory tags when available", async () => {
    mockGetAgentsMdContent.mockResolvedValue("The user prefers bullet points.");
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("<agent_memory>");
    expect(prompt).toContain("The user prefers bullet points.");
    expect(prompt).toContain("</agent_memory>");
  });

  it("skips memory section when AGENTS.md is empty", async () => {
    mockGetAgentsMdContent.mockResolvedValue("");
    const agent = makeAgent({ skills: ["self-improvement"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).not.toContain("## Memory");
    expect(prompt).not.toContain("<agent_memory>");
  });

  it("skips entire memory section for agent with no content", async () => {
    mockGetAgentsMdContent.mockResolvedValue("");
    const agent = makeAgent({ skills: ["daily-digest"], tools: [] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).not.toContain("## Memory");
    expect(prompt).not.toContain("<agent_memory>");
  });

  // ── Layer 3: System context ──

  it("includes capabilities section with store instructions", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("## Capabilities");
    expect(prompt).toContain("/store/");
    expect(prompt).toContain("Skills:");
  });

  it("includes rules with dedup and token budget", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("## Rules");
    expect(prompt).toContain("search before creating duplicate");
    expect(prompt).toContain("token budget");
  });

  it("does not include approval settings in rules", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).not.toContain("Approval required");
  });

  it("includes context with timezone and date", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("## Context");
    expect(prompt).toContain("Timezone: America/New_York");
  });

  it("does not include item types in system prompt", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).not.toContain("Available Item Types");
  });

  it("does not include common metadata in system prompt", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).not.toContain("Common Metadata Fields");
    expect(prompt).not.toContain("recommended_by");
  });

  it("does not include active lists in system prompt", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).not.toContain("Active Lists");
  });

  it("does not include memory guidelines in system prompt", async () => {
    const agent = makeAgent({ skills: ["self-improvement"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).not.toContain("<memory_guidelines>");
    expect(prompt).not.toContain("</memory_guidelines>");
  });

  it("does not include external integrations section", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).not.toContain("External Integrations");
  });

  // ── Layer ordering ──

  it("orders layers: agent prompt → memory → system context", async () => {
    mockGetAgentsMdContent.mockResolvedValue("User likes coffee.");
    const agent = makeAgent({ system_prompt: "You are test_bot.", skills: ["self-improvement"] });
    const prompt = await buildPrompt(agent, settings);

    const agentPromptIdx = prompt.indexOf("You are test_bot.");
    const memoryIdx = prompt.indexOf("<agent_memory>");
    const capabilitiesIdx = prompt.indexOf("## Capabilities");
    const rulesIdx = prompt.indexOf("## Rules");

    expect(agentPromptIdx).toBeLessThan(memoryIdx);
    expect(memoryIdx).toBeLessThan(capabilitiesIdx);
    expect(capabilitiesIdx).toBeLessThan(rulesIdx);
  });
});
