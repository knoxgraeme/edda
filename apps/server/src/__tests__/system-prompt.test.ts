/**
 * System prompt builder tests — AGENTS.md from DB, item types, skills,
 * approval settings, MCP connections.
 *
 * Mocks @edda/db for settings, connections, skills, item types, and AGENTS.md content.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";

// Use vi.hoisted() so these mocks are available inside vi.mock() factories
const {
  mockGetSettingsSync,
  mockGetAgentsMdContent,
  mockGetItemTypes,
  mockGetMcpConnections,
  mockGetSkillSummaries,
} = vi.hoisted(() => {
  return {
    mockGetSettingsSync: vi.fn(),
    mockGetAgentsMdContent: vi.fn().mockResolvedValue(""),
    mockGetItemTypes: vi.fn().mockResolvedValue([]),
    mockGetMcpConnections: vi.fn().mockResolvedValue([]),
    mockGetSkillSummaries: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
  getAgentsMdContent: mockGetAgentsMdContent,
  getItemTypes: mockGetItemTypes,
  getMcpConnections: mockGetMcpConnections,
  getSkillSummaries: mockGetSkillSummaries,
}));

import { buildSystemPrompt } from "../agent/prompts/system.js";

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
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
    mockGetSkillSummaries.mockResolvedValue([]);
    mockGetAgentsMdContent.mockResolvedValue(""); // default: no AGENTS.md content
  });

  it("output includes item type names from DB", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("**note**");
    expect(prompt).toContain("**task**");
    expect(prompt).toContain("General notes");
    expect(prompt).toContain("Action items");
  });

  it("output includes AGENTS.md content when available", async () => {
    mockGetAgentsMdContent.mockResolvedValue("The user prefers bullet points.");
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("About This User");
    expect(prompt).toContain("The user prefers bullet points.");
  });

  it("handles empty AGENTS.md gracefully", async () => {
    mockGetAgentsMdContent.mockResolvedValue("");
    const prompt = await buildSystemPrompt();
    // Should not throw and should not contain the "About This User" section
    expect(prompt).not.toContain("About This User");
    // But should still have the core prompt
    expect(prompt).toContain("You are Edda");
  });

  it("includes approval settings", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("Approval Settings");
    expect(prompt).toContain(DEFAULT_TEST_SETTINGS.approval_new_type);
  });

  it("output includes skills section when skills exist", async () => {
    mockGetSkillSummaries.mockResolvedValue([
      { name: "capture", description: "Captures user input" },
    ]);
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("**capture**");
    expect(prompt).toContain("Captures user input");
  });
});
