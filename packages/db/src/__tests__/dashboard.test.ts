/**
 * Dashboard query function tests — parallel queries, list grouping, pending counts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import { getDashboard, getPendingConfirmationsCount } from "../dashboard.js";

vi.mock("../index.js");

describe("dashboard", () => {
  let query: ReturnType<typeof mockGetPool>["query"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query } = mockGetPool());
  });

  describe("getDashboard()", () => {
    it("fires 5 parallel queries and groups list items by list_name", async () => {
      // 5 queries: dueToday, capturedToday, openItems, lists, pending
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dueToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // capturedToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // openItems
        .mockResolvedValueOnce({
          rows: [
            { id: "l1", type: "list_item", metadata: { list_name: "groceries" } },
            { id: "l2", type: "list_item", metadata: { list_name: "groceries" } },
            { id: "l3", type: "list_item", metadata: { list_name: "books" } },
          ],
          rowCount: 3,
        }) // lists
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // pending

      const result = await getDashboard("2026-02-21");

      expect(query).toHaveBeenCalledTimes(5);
      expect(result.lists).toEqual({
        groceries: [
          { id: "l1", type: "list_item", metadata: { list_name: "groceries" } },
          { id: "l2", type: "list_item", metadata: { list_name: "groceries" } },
        ],
        books: [{ id: "l3", type: "list_item", metadata: { list_name: "books" } }],
      });
      expect(result.due_today).toEqual([]);
      expect(result.captured_today).toEqual([]);
      expect(result.open_items).toEqual([]);
      expect(result.pending_confirmations).toEqual([]);
    });

    it("defaults day to today when not provided", async () => {
      query.mockResolvedValue({ rows: [], rowCount: 0 });

      const today = new Date().toISOString().split("T")[0];
      await getDashboard();

      // All 5 queries called; the first 3 receive the date parameter
      // Check that first query uses today's date
      const firstCallParams = query.mock.calls[0][1];
      expect(firstCallParams).toEqual([today]);
    });
  });

  describe("getPendingConfirmationsCount()", () => {
    it("sums across items, item_types, and entities tables", async () => {
      query.mockResolvedValueOnce({ rows: [{ total: "7" }], rowCount: 1 });

      const count = await getPendingConfirmationsCount();

      expect(query).toHaveBeenCalledOnce();
      const [sql] = query.mock.calls[0];
      expect(sql).toContain("SELECT count(*) FROM items WHERE confirmed = false");
      expect(sql).toContain("SELECT count(*) FROM item_types WHERE confirmed = false");
      expect(sql).toContain("SELECT count(*) FROM entities WHERE confirmed = false");
      expect(count).toBe(7);
    });
  });
});
