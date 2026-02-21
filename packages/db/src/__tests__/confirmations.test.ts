/**
 * Confirmation query tests — table validation, confirm/reject logic
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import { confirmPending, rejectPending } from "../confirmations.js";

vi.mock("../index.js");

describe("confirmations", () => {
  let query: ReturnType<typeof mockGetPool>["query"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query } = mockGetPool());
  });

  describe("assertValidTable()", () => {
    it("rejects tables outside allowlist", async () => {
      await expect(
        confirmPending("users" as "items", "id-1"),
      ).rejects.toThrow("Invalid table for confirmation: users");
    });

    it("throws for SQL injection attempts", async () => {
      await expect(
        confirmPending("items; DROP TABLE items--" as "items", "id-1"),
      ).rejects.toThrow("Invalid table for confirmation");
    });
  });

  describe("confirmPending()", () => {
    it("item_types uses name key, not id", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await confirmPending("item_types", "my-type");

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("UPDATE item_types SET confirmed = true");
      expect(sql).toContain("WHERE name = $1");
      expect(params).toEqual(["my-type"]);
    });

    it("items and entities use id key", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await confirmPending("items", "item-1");

      const [sql1, params1] = query.mock.calls[0];
      expect(sql1).toContain("UPDATE items SET confirmed = true");
      expect(sql1).toContain("WHERE id = $1");
      expect(params1).toEqual(["item-1"]);

      vi.clearAllMocks();
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await confirmPending("entities", "ent-1");

      const [sql2, params2] = query.mock.calls[0];
      expect(sql2).toContain("UPDATE entities SET confirmed = true");
      expect(sql2).toContain("WHERE id = $1");
      expect(params2).toEqual(["ent-1"]);
    });
  });

  describe("rejectPending()", () => {
    it("deletes only confirmed=false rows using id for items/entities", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await rejectPending("items", "item-1");

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("DELETE FROM items WHERE id = $1 AND confirmed = false");
      expect(params).toEqual(["item-1"]);
    });

    it("deletes item_types using name key", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await rejectPending("item_types", "my-type");

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("DELETE FROM item_types WHERE name = $1 AND confirmed = false");
      expect(params).toEqual(["my-type"]);
    });
  });
});
