/**
 * System prompt builder tests — item types, AGENTS.md, graceful fallback.
 *
 * Mocks @edda/db for settings/item types/connections and fs/promises for AGENTS.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted() so these mocks are available inside vi.mock() factories
const {
  mockGetSettingsSync,
  mockGetItemTypes,
  mockGetMcpConnections,
  mockReadFile,
  DEFAULT_SETTINGS,
} = vi.hoisted(() => {
  const DEFAULT_SETTINGS = {
    id: true,
    llm_provider: "anthropic",
    default_model: "claude-sonnet-4-20250514",
    embedding_provider: "voyage",
    embedding_model: "voyage-3",
    embedding_dimensions: 1536,
    search_provider: "tavily",
    web_search_enabled: false,
    web_search_max_results: 5,
    checkpointer_backend: "memory",
    memory_extraction_enabled: true,
    memory_extraction_cron: "0 2 * * *",
    memory_extraction_model: "claude-sonnet-4-20250514",
    memory_reinforce_threshold: 0.95,
    memory_update_threshold: 0.85,
    entity_exact_threshold: 0.95,
    entity_fuzzy_threshold: 0.8,
    agents_md_token_budget: 1500,
    agents_md_max_per_category: 10,
    agents_md_max_versions: 3,
    agents_md_max_entities: 10,
    tool_call_limit_global: 30,
    tool_call_limit_delete: 10,
    tool_call_limit_archive: 15,
    user_crons_enabled: false,
    user_cron_check_interval: "*/5 * * * *",
    user_cron_model: "claude-sonnet-4-20250514",
    cron_runner: "standalone",
    langgraph_platform_url: null,
    approval_new_type: "confirm",
    approval_archive_stale: "confirm",
    approval_merge_entity: "confirm",
    system_prompt_override: null,
    setup_completed: false,
    user_display_name: null,
    user_timezone: "America/New_York",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    mockGetSettingsSync: vi.fn(() => DEFAULT_SETTINGS),
    mockGetItemTypes: vi.fn().mockResolvedValue([]),
    mockGetMcpConnections: vi.fn().mockResolvedValue([]),
    mockReadFile: vi.fn(),
    DEFAULT_SETTINGS,
  };
});

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
  getItemTypes: mockGetItemTypes,
  getMcpConnections: mockGetMcpConnections,
}));

vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
}));

import { buildSystemPrompt } from "../agent/prompts/system.js";

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockGetSettingsSync.mockReturnValue(DEFAULT_SETTINGS);
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
});
