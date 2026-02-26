/**
 * Tests for generate-agents-md.ts — buildTemplateDiff and buildDeterministicTemplate.
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
  mockGetAllLists,
} = vi.hoisted(() => ({
  mockGetSettingsSync: vi.fn(),
  mockGetItemsByType: vi.fn().mockResolvedValue([]),
  mockGetTopEntities: vi.fn().mockResolvedValue([]),
  mockGetItemTypes: vi.fn().mockResolvedValue([]),
  mockGetPendingConfirmationsCount: vi.fn().mockResolvedValue(0),
  mockGetAllLists: vi.fn().mockResolvedValue([]),
}));

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
  getItemsByType: mockGetItemsByType,
  getTopEntities: mockGetTopEntities,
  getItemTypes: mockGetItemTypes,
  getPendingConfirmationsCount: mockGetPendingConfirmationsCount,
  getAllLists: mockGetAllLists,
}));

import {
  buildTemplateDiff,
  buildDeterministicTemplate,
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

describe("buildDeterministicTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
  });

  it("returns a template string and SHA-256 hash", async () => {
    const result = await buildDeterministicTemplate();
    expect(result.template).toContain("# Change Signal");
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("includes preferences when present", async () => {
    mockGetItemsByType.mockImplementation((type: string) =>
      type === "preference"
        ? Promise.resolve([{ content: "Prefers dark mode" }])
        : Promise.resolve([]),
    );
    const result = await buildDeterministicTemplate();
    expect(result.template).toContain("## Preferences");
    expect(result.template).toContain("- Prefers dark mode");
  });

  it("includes entities when present", async () => {
    mockGetTopEntities.mockResolvedValue([
      { name: "Alice", type: "person", description: "Friend", mention_count: 5 },
    ]);
    const result = await buildDeterministicTemplate();
    expect(result.template).toContain("## Key Entities");
    expect(result.template).toContain("**Alice** (person)");
  });

  it("produces stable hashes for identical data", async () => {
    const result1 = await buildDeterministicTemplate();
    const result2 = await buildDeterministicTemplate();
    expect(result1.hash).toBe(result2.hash);
  });

  it("produces different hashes when data changes", async () => {
    const result1 = await buildDeterministicTemplate();

    mockGetItemsByType.mockImplementation((type: string) =>
      type === "preference"
        ? Promise.resolve([{ content: "New preference" }])
        : Promise.resolve([]),
    );
    const result2 = await buildDeterministicTemplate();

    expect(result1.hash).not.toBe(result2.hash);
  });
});
