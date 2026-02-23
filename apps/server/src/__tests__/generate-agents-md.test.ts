/**
 * Tests for generate-agents-md.ts — buildTemplateDiff and maybeRefreshAgentsMd.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";

// ── Mocks ──────────────────────────────────────────────────────

const {
  mockGetSettingsSync,
  mockGetItemsByType,
  mockGetTopEntities,
  mockGetItemTypes,
  mockGetPendingConfirmationsCount,
  mockGetLatestAgentsMd,
  mockSaveAgentsMdVersion,
} = vi.hoisted(() => ({
  mockGetSettingsSync: vi.fn(),
  mockGetItemsByType: vi.fn().mockResolvedValue([]),
  mockGetTopEntities: vi.fn().mockResolvedValue([]),
  mockGetItemTypes: vi.fn().mockResolvedValue([]),
  mockGetPendingConfirmationsCount: vi.fn().mockResolvedValue(0),
  mockGetLatestAgentsMd: vi.fn().mockResolvedValue(null),
  mockSaveAgentsMdVersion: vi.fn(),
}));

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
  getItemsByType: mockGetItemsByType,
  getTopEntities: mockGetTopEntities,
  getItemTypes: mockGetItemTypes,
  getPendingConfirmationsCount: mockGetPendingConfirmationsCount,
  getLatestAgentsMd: mockGetLatestAgentsMd,
  saveAgentsMdVersion: mockSaveAgentsMdVersion,
  pruneAgentsMdVersions: vi.fn(),
  createAgentLog: vi.fn(),
}));

vi.mock("../llm/index.js", () => ({
  getChatModel: vi.fn(),
}));

vi.mock("../agent/tools/save-agents-md.js", () => ({
  saveAgentsMdTool: {},
}));

import {
  buildTemplateDiff,
  maybeRefreshAgentsMd,
  _resetHashCache,
} from "../agent/generate-agents-md.js";

// ── Tests ──────────────────────────────────────────────────────

describe("buildTemplateDiff", () => {
  it("shows added lines with + prefix", () => {
    const diff = buildTemplateDiff("line1\nline2", "line1\nline2\nline3");
    expect(diff).toContain("+ line3");
    expect(diff).not.toContain("- ");
  });

  it("shows removed lines with - prefix", () => {
    const diff = buildTemplateDiff("line1\nline2\nline3", "line1\nline2");
    expect(diff).toContain("- line3");
    expect(diff).not.toContain("+ ");
  });

  it("shows both added and removed lines", () => {
    const diff = buildTemplateDiff("old line", "new line");
    expect(diff).toContain("- old line");
    expect(diff).toContain("+ new line");
  });

  it("returns '(no changes)' when templates are identical", () => {
    const diff = buildTemplateDiff("same\ncontent", "same\ncontent");
    expect(diff).toBe("(no changes)");
  });

  it("handles empty strings", () => {
    expect(buildTemplateDiff("", "")).toBe("(no changes)");
    expect(buildTemplateDiff("", "new")).toContain("+ new");
    expect(buildTemplateDiff("old", "")).toContain("- old");
  });
});

describe("maybeRefreshAgentsMd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetHashCache();
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
  });

  it("skips save when hash matches latest version", async () => {
    // Mock: template will produce some hash. We set the latest version to have that same hash.
    // Since buildDeterministicTemplate uses real crypto, we need to let it run and capture the hash.
    mockGetLatestAgentsMd.mockResolvedValue({
      id: 1,
      content: "existing content",
      template: "old template",
      input_hash: "will-be-replaced",
      created_at: "2026-01-01",
    });

    // First call to get the actual hash
    await maybeRefreshAgentsMd();

    // saveAgentsMdVersion should have been called since hashes won't match
    expect(mockSaveAgentsMdVersion).toHaveBeenCalledTimes(1);
    const savedHash = mockSaveAgentsMdVersion.mock.calls[0][2];

    // Reset and set the latest to have the matching hash
    vi.clearAllMocks();
    _resetHashCache();
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
    mockGetLatestAgentsMd.mockResolvedValue({
      id: 2,
      content: "existing content",
      template: "some template",
      input_hash: savedHash,
      created_at: "2026-01-01",
    });

    // Second call — hash should match, so no save
    await maybeRefreshAgentsMd();
    expect(mockSaveAgentsMdVersion).not.toHaveBeenCalled();
  });

  it("saves new version when hash differs from latest", async () => {
    mockGetLatestAgentsMd.mockResolvedValue({
      id: 1,
      content: "old content",
      template: "old template",
      input_hash: "different-hash",
      created_at: "2026-01-01",
    });

    await maybeRefreshAgentsMd();

    expect(mockSaveAgentsMdVersion).toHaveBeenCalledTimes(1);
    // Should preserve existing content
    expect(mockSaveAgentsMdVersion.mock.calls[0][0]).toBe("old content");
  });

  it("saves when no previous version exists", async () => {
    mockGetLatestAgentsMd.mockResolvedValue(null);

    await maybeRefreshAgentsMd();

    expect(mockSaveAgentsMdVersion).toHaveBeenCalledTimes(1);
    // Content should be empty string when no previous version
    expect(mockSaveAgentsMdVersion.mock.calls[0][0]).toBe("");
  });

  it("uses in-memory cache to skip DB queries on rapid calls", async () => {
    mockGetLatestAgentsMd.mockResolvedValue({
      id: 1,
      content: "content",
      template: "template",
      input_hash: "some-hash",
      created_at: "2026-01-01",
    });

    // First call — will hit DB
    await maybeRefreshAgentsMd();
    expect(mockGetLatestAgentsMd).toHaveBeenCalledTimes(1);

    // Second call — should use cache and skip DB entirely
    await maybeRefreshAgentsMd();
    // getLatestAgentsMd should NOT have been called again
    expect(mockGetLatestAgentsMd).toHaveBeenCalledTimes(1);
  });
});
