/**
 * Tool invocation tests — save_agents_md and get_context_diff tools.
 *
 * Verifies save_agents_md rebuilds template, saves version, and prunes.
 * Verifies get_context_diff returns correct status for changed/unchanged data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetSettingsSync,
  mockSaveAgentsMdVersion,
  mockPruneAgentsMdVersions,
  mockGetLatestAgentsMd,
  mockGetItemsByType,
  mockGetTopEntities,
  mockGetItemTypes,
  mockGetPendingConfirmationsCount,
  mockGetAllLists,
} = vi.hoisted(() => ({
  mockGetSettingsSync: vi.fn(),
  mockSaveAgentsMdVersion: vi.fn().mockResolvedValue(undefined),
  mockPruneAgentsMdVersions: vi.fn().mockResolvedValue(undefined),
  mockGetLatestAgentsMd: vi.fn().mockResolvedValue(null),
  mockGetItemsByType: vi.fn().mockResolvedValue([]),
  mockGetTopEntities: vi.fn().mockResolvedValue([]),
  mockGetItemTypes: vi.fn().mockResolvedValue([]),
  mockGetPendingConfirmationsCount: vi.fn().mockResolvedValue(0),
  mockGetAllLists: vi.fn().mockResolvedValue([]),
}));

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
  saveAgentsMdVersion: mockSaveAgentsMdVersion,
  pruneAgentsMdVersions: mockPruneAgentsMdVersions,
  getLatestAgentsMd: mockGetLatestAgentsMd,
  getItemsByType: mockGetItemsByType,
  getTopEntities: mockGetTopEntities,
  getItemTypes: mockGetItemTypes,
  getPendingConfirmationsCount: mockGetPendingConfirmationsCount,
  getAllLists: mockGetAllLists,
}));

import { saveAgentsMdTool } from "../../agent/tools/save-agents-md.js";
import { getContextDiffTool } from "../../agent/tools/get-context-diff.js";

const DEFAULT_SETTINGS = {
  agents_md_token_budget: 1500,
  agents_md_max_per_category: 10,
  agents_md_max_versions: 3,
  agents_md_max_entities: 10,
  user_display_name: null,
  user_timezone: "America/New_York",
  approval_new_type: "confirm",
  approval_archive_stale: "confirm",
  approval_merge_entity: "confirm",
};

// ── Tests ──────────────────────────────────────────────────────

describe("save_agents_md tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_SETTINGS);
  });

  it("saves content and prunes old versions", async () => {
    const result = await saveAgentsMdTool.invoke({ content: "# My AGENTS.md" });
    const parsed = JSON.parse(result);

    expect(parsed.saved).toBe(true);
    expect(parsed.length).toBe(14);

    expect(mockSaveAgentsMdVersion).toHaveBeenCalledOnce();
    const call = mockSaveAgentsMdVersion.mock.calls[0][0];
    expect(call.content).toBe("# My AGENTS.md");
    expect(call.template).toContain("# Raw Template Data");
    expect(call.inputHash).toMatch(/^[a-f0-9]{64}$/);

    expect(mockPruneAgentsMdVersions).toHaveBeenCalledWith(3);
  });

  it("uses max_versions from settings for pruning", async () => {
    mockGetSettingsSync.mockReturnValue({ ...DEFAULT_SETTINGS, agents_md_max_versions: 10 });
    await saveAgentsMdTool.invoke({ content: "content" });
    expect(mockPruneAgentsMdVersions).toHaveBeenCalledWith(10);
  });
});

describe("get_context_diff tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_SETTINGS);
  });

  it("returns no_changes when hash matches", async () => {
    // Build a template to get its hash
    const { buildDeterministicTemplate } = await import("../../agent/generate-agents-md.js");
    const { hash, template } = await buildDeterministicTemplate();

    mockGetLatestAgentsMd.mockResolvedValue({
      content: "existing content",
      template,
      input_hash: hash,
    });

    const result = await getContextDiffTool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("no_changes");
  });

  it("returns changes_detected when hash differs", async () => {
    mockGetLatestAgentsMd.mockResolvedValue({
      content: "old content",
      template: "old template",
      input_hash: "0000000000000000000000000000000000000000000000000000000000000000",
    });

    const result = await getContextDiffTool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("changes_detected");
    expect(parsed.current_content).toBe("old content");
    expect(parsed.diff).toBeDefined();
    expect(parsed.raw_template).toContain("# Raw Template Data");
    expect(parsed.token_budget).toBe(1500);
  });

  it("returns changes_detected when no prior version exists", async () => {
    mockGetLatestAgentsMd.mockResolvedValue(null);

    const result = await getContextDiffTool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("changes_detected");
    expect(parsed.current_content).toBe("(empty — first version)");
  });
});
