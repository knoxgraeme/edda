/**
 * System prompt builder tests — AGENTS.md from DB, approval settings, MCP connections.
 *
 * Mocks @edda/db for settings, connections, and AGENTS.md content.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";

// Use vi.hoisted() so these mocks are available inside vi.mock() factories
const {
  mockGetSettingsSync,
  mockGetAgentsMdContent,
  mockGetMcpConnections,
} = vi.hoisted(() => {
  return {
    mockGetSettingsSync: vi.fn(),
    mockGetAgentsMdContent: vi.fn().mockResolvedValue(""),
    mockGetMcpConnections: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
  getAgentsMdContent: mockGetAgentsMdContent,
  getMcpConnections: mockGetMcpConnections,
}));

import { buildSystemPrompt } from "../agent/prompts/system.js";

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
    mockGetMcpConnections.mockResolvedValue([]);
    mockGetAgentsMdContent.mockResolvedValue(""); // default: no AGENTS.md content
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
});
