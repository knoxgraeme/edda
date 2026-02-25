/**
 * Prompt builder tests — AGENTS.md from DB, item types,
 * approval settings, MCP connections.
 *
 * Tests buildPrompt() from build-agent.ts, which is the unified
 * prompt builder for all agents.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";
import type { Agent, Settings } from "@edda/db";

// Use vi.hoisted() so these mocks are available inside vi.mock() factories
const { mockGetAgentsMdContent, mockGetItemTypes, mockGetMcpConnections } = vi.hoisted(() => {
  return {
    mockGetAgentsMdContent: vi.fn().mockResolvedValue(""),
    mockGetItemTypes: vi.fn().mockResolvedValue([]),
    mockGetMcpConnections: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@edda/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAgentsMdContent: mockGetAgentsMdContent,
    getItemTypes: mockGetItemTypes,
    getMcpConnections: mockGetMcpConnections,
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
    context_mode: "isolated",
    trigger: "on_demand",
    tools: [],
    subagents: [],
    model_settings_key: null,
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
    mockGetMcpConnections.mockResolvedValue([]);
    mockGetAgentsMdContent.mockResolvedValue("");
  });

  it("includes item type names from DB", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("**note**");
    expect(prompt).toContain("**task**");
    expect(prompt).toContain("General notes");
    expect(prompt).toContain("Action items");
  });

  it("includes AGENTS.md content when available", async () => {
    mockGetAgentsMdContent.mockResolvedValue("The user prefers bullet points.");
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("About This User");
    expect(prompt).toContain("The user prefers bullet points.");
  });

  it("handles empty AGENTS.md gracefully", async () => {
    mockGetAgentsMdContent.mockResolvedValue("");
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).not.toContain("About This User");
  });

  it("includes approval settings", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("Approval Settings");
    expect(prompt).toContain(settings.approval_new_type);
  });

  it("includes item types for all agents regardless of tools", async () => {
    // Agent with scoped tools still gets item types (no isOrchestrator gate)
    const agent = makeAgent({ tools: ["search_items", "create_item"] });
    const prompt = await buildPrompt(agent, settings);
    expect(prompt).toContain("Available Item Types");
    expect(prompt).toContain("**note**");
  });

  it("includes external integrations section", async () => {
    mockGetMcpConnections.mockResolvedValue([
      {
        id: "1",
        name: "slack",
        transport: "sse",
        url: "http://localhost",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ]);
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("External Integrations");
    expect(prompt).toContain("slack (sse)");
  });

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

  it("includes persistent store instructions", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("Persistent Store");
    expect(prompt).toContain("/store/");
  });

  it("includes timezone and date context", async () => {
    const prompt = await buildPrompt(makeAgent(), settings);
    expect(prompt).toContain("Timezone: America/New_York");
  });
});
