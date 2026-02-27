/**
 * Prompt builder tests — three-layer system prompt structure.
 *
 * Tests buildPrompt() from build-agent.ts which assembles:
 * Layer 1: Agent prompt (task description)
 * Layer 2: Memory (AGENTS.md + guidelines)
 * Layer 3: System context (capabilities, rules, reference data)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";
import type { Agent, Settings } from "@edda/db";

// Use vi.hoisted() so these mocks are available inside vi.mock() factories
const { mockGetAgentsMdContent, mockGetItemTypes, mockGetAllLists } = vi.hoisted(() => {
  return {
    mockGetAgentsMdContent: vi.fn().mockResolvedValue(""),
    mockGetItemTypes: vi.fn().mockResolvedValue([]),
    mockGetAllLists: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@edda/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAgentsMdContent: mockGetAgentsMdContent,
    getItemTypes: mockGetItemTypes,
    getAllLists: mockGetAllLists,
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

    mockGetItemTypes.mockResolvedValue([
      {
        name: "note",
        icon: "\u{1F4DD}",
        classification_hint: "General notes",
        fields: {},
        agent_internal: false,
        confirmed: true,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
      {
        name: "task",
        icon: "\u2705",
        classification_hint: "Action items",
        fields: {},
        agent_internal: false,
        confirmed: true,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ]);
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

  it("shows placeholder when AGENTS.md is empty but agent has memory tools", async () => {
    mockGetAgentsMdContent.mockResolvedValue("");
    const agent = makeAgent({ skills: ["self_improvement"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("<agent_memory>");
    expect(prompt).toContain("No operating notes yet");
    expect(prompt).toContain("</agent_memory>");
  });

  it("includes memory guidelines when agent has self_improvement skill", async () => {
    const agent = makeAgent({ skills: ["self_improvement"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("<memory_guidelines>");
    expect(prompt).toContain("save_agents_md");
    expect(prompt).toContain("Memory vs Items");
    expect(prompt).toContain("</memory_guidelines>");
  });

  it("includes memory guidelines when agent has save_agents_md tool", async () => {
    const agent = makeAgent({ tools: ["save_agents_md"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("<memory_guidelines>");
  });

  it("excludes memory guidelines when agent has no memory tools", async () => {
    const agent = makeAgent({ skills: ["daily_digest"], tools: ["search_items"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).not.toContain("<memory_guidelines>");
    expect(prompt).not.toContain("</memory_guidelines>");
  });

  it("includes agent_memory tags without guidelines for agent with content but no memory tools", async () => {
    mockGetAgentsMdContent.mockResolvedValue("User prefers concise output.");
    const agent = makeAgent({ skills: ["daily_digest"], tools: [] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("<agent_memory>");
    expect(prompt).toContain("User prefers concise output.");
    expect(prompt).toContain("</agent_memory>");
    expect(prompt).not.toContain("<memory_guidelines>");
  });

  it("skips entire memory section for agent with no content and no memory tools", async () => {
    mockGetAgentsMdContent.mockResolvedValue("");
    const agent = makeAgent({ skills: ["daily_digest"], tools: [] });
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

  it("includes rules with approval settings", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("## Rules");
    expect(prompt).toContain(settings.approval_new_type);
    expect(prompt).toContain(settings.approval_archive_stale);
  });

  it("includes context with timezone and date", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("## Context");
    expect(prompt).toContain("Timezone: America/New_York");
  });

  it("includes item type names from DB", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("## Available Item Types");
    expect(prompt).toContain("**note**");
    expect(prompt).toContain("**task**");
    expect(prompt).toContain("General notes");
    expect(prompt).toContain("Action items");
  });

  it("includes item types for all agents regardless of tools", async () => {
    const agent = makeAgent({ tools: ["search_items", "create_item"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("Available Item Types");
    expect(prompt).toContain("**note**");
  });

  it("includes common metadata fields", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("## Common Metadata Fields");
    expect(prompt).toContain("recommended_by");
  });

  it("does not include external integrations section", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).not.toContain("External Integrations");
  });

  // ── Layer ordering ──

  it("orders layers: agent prompt → memory → system context", async () => {
    mockGetAgentsMdContent.mockResolvedValue("User likes coffee.");
    const agent = makeAgent({ system_prompt: "You are test_bot.", skills: ["self_improvement"] });
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
