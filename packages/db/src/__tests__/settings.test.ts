/**
 * Settings query function tests — covers cache behavior, column whitelist
 * security, and refresh semantics.
 *
 * Settings uses a module-level `cachedSettings` variable, so tests use
 * `vi.resetModules()` to get fresh module state for cache isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";

vi.mock("../connection.js");

describe("settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPool();
  });

  // ── getSettingsSync ─────────────────────────────────────────────

  describe("getSettingsSync", () => {
    it('throws "Settings not loaded" when cache is null', async () => {
      // Reset modules to get a fresh settings module with null cache
      vi.resetModules();
      const { getSettingsSync } = await import("../settings.js");

      expect(() => getSettingsSync()).toThrow("Settings not loaded");
    });

    it("returns cached value after refreshSettings()", async () => {
      vi.resetModules();
      // Re-setup mock after module reset
      const { getPool } = await import("../index.js");
      const { createMockPool } = await import("./helpers.js");
      const mock = createMockPool();
      vi.mocked(getPool).mockReturnValue(
        mock.pool as unknown as ReturnType<typeof getPool>,
      );

      const fakeSettings = { id: true, llm_provider: "anthropic", default_model: "claude" };
      mock.query.mockResolvedValueOnce({ rows: [fakeSettings], rowCount: 1 });

      const { getSettingsSync, refreshSettings } = await import("../settings.js");
      await refreshSettings();

      const result = getSettingsSync();
      expect(result).toEqual(fakeSettings);
    });
  });

  // ── refreshSettings ─────────────────────────────────────────────

  describe("refreshSettings", () => {
    it("throws when settings row is missing", async () => {
      vi.resetModules();
      const { getPool } = await import("../index.js");
      const { createMockPool } = await import("./helpers.js");
      const mock = createMockPool();
      vi.mocked(getPool).mockReturnValue(
        mock.pool as unknown as ReturnType<typeof getPool>,
      );

      mock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const { refreshSettings } = await import("../settings.js");
      await expect(refreshSettings()).rejects.toThrow("Settings row missing");
    });
  });

  // ── updateSettings ──────────────────────────────────────────────

  describe("updateSettings", () => {
    it("column whitelist rejects unknown keys", async () => {
      vi.resetModules();
      const { getPool } = await import("../index.js");
      const { createMockPool } = await import("./helpers.js");
      const mock = createMockPool();
      vi.mocked(getPool).mockReturnValue(
        mock.pool as unknown as ReturnType<typeof getPool>,
      );

      const fakeSettings = { id: true, llm_provider: "anthropic" };
      // First call: getSettings fallback (cache is null, so refreshSettings)
      mock.query.mockResolvedValueOnce({ rows: [fakeSettings], rowCount: 1 });

      const { updateSettings } = await import("../settings.js");

      // Pass only unknown keys — should fall through to getSettings(), not UPDATE
      const result = await updateSettings({
        ['; DROP TABLE settings --']: "pwned",
      } as never);

      // Should have called SELECT (refreshSettings via getSettings), not UPDATE
      const allSql = mock.query.mock.calls.map(([sql]: [string]) => sql);
      expect(allSql.every((sql: string) => !sql.includes("UPDATE"))).toBe(true);
      expect(allSql.every((sql: string) => !sql.includes("DROP"))).toBe(true);
      expect(result).toEqual(fakeSettings);
    });

    it("calls refreshSettings() after update to invalidate cache", async () => {
      vi.resetModules();
      const { getPool } = await import("../index.js");
      const { createMockPool } = await import("./helpers.js");
      const mock = createMockPool();
      vi.mocked(getPool).mockReturnValue(
        mock.pool as unknown as ReturnType<typeof getPool>,
      );

      const updatedSettings = { id: true, llm_provider: "openai" };
      // First call: UPDATE
      mock.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // Second call: refreshSettings SELECT
      mock.query.mockResolvedValueOnce({ rows: [updatedSettings], rowCount: 1 });

      const { updateSettings } = await import("../settings.js");
      const result = await updateSettings({ llm_provider: "openai" } as never);

      expect(mock.query).toHaveBeenCalledTimes(2);

      // First call: UPDATE
      const [updateSql, updateParams] = mock.query.mock.calls[0];
      expect(updateSql).toEqual(expect.stringContaining("UPDATE settings SET"));
      expect(updateSql).toEqual(expect.stringContaining('"llm_provider" = $1'));
      expect(updateParams).toEqual(["openai"]);

      // Second call: SELECT (refreshSettings)
      const [selectSql] = mock.query.mock.calls[1];
      expect(selectSql).toEqual(expect.stringContaining("SELECT * FROM settings"));

      expect(result).toEqual(updatedSettings);
    });
  });
});
