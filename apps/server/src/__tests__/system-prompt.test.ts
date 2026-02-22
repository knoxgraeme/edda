/**
 * System prompt builder tests — item types, AGENTS.md, graceful fallback.
 *
 * Mocks @edda/db for settings/item types/connections and fs/promises for AGENTS.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";

// Use vi.hoisted() so these mocks are available inside vi.mock() factories
const {
  mockGetSettingsSync,
  mockGetItemTypes,
  mockGetMcpConnections,
  mockGetSkillSummaries,
  mockReadFile,
} = vi.hoisted(() => {
  return {
    mockGetSettingsSync: vi.fn(),
    mockGetItemTypes: vi.fn().mockResolvedValue([]),
    mockGetMcpConnections: vi.fn().mockResolvedValue([]),
    mockGetSkillSummaries: vi.fn().mockResolvedValue([]),
    mockReadFile: vi.fn(),
  };
});

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
  getItemTypes: mockGetItemTypes,
  getMcpConnections: mockGetMcpConnections,
  getSkillSummaries: mockGetSkillSummaries,
}));

vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
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
    mockReadFile.mockRejectedValue(new Error("ENOENT")); // default: no AGENTS.md
  });

  it("output includes item type names from DB", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("**note**");
    expect(prompt).toContain("**task**");
    expect(prompt).toContain("General notes");
    expect(prompt).toContain("Action items");
  });

  it("output includes AGENTS.md content when file exists", async () => {
    mockReadFile.mockResolvedValue("The user prefers bullet points.");
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("About This User");
    expect(prompt).toContain("The user prefers bullet points.");
  });

  it("handles missing AGENTS.md gracefully", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));
    const prompt = await buildSystemPrompt();
    // Should not throw and should not contain the "About This User" section
    expect(prompt).not.toContain("About This User");
    // But should still have the core prompt
    expect(prompt).toContain("You are Edda");
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
