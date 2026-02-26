/**
 * Dashboard query function tests — parallel queries, list grouping, pending counts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import { getDashboard, getPendingConfirmationsCount } from "../dashboard.js";

vi.mock("../connection.js");

describe("dashboard", () => {
  let query: ReturnType<typeof mockGetPool>["query"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query } = mockGetPool());
  });

  describe("getDashboard()", () => {
    it("fires 5 parallel queries and groups list items by list id", async () => {
      // 5 queries: dueToday, capturedToday, openItems, lists (JOIN), pending
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dueToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // capturedToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // openItems
        .mockResolvedValueOnce({
          rows: [
            {
              list_id: "grocery-list", list_name: "groceries", list_normalized_name: "groceries",
              list_summary: null, list_icon: "cart", list_list_type: "rolling",
              list_status: "active", list_embedding_model: null, list_metadata: {},
              list_created_at: "2026-01-01", list_updated_at: "2026-01-01",
              id: "i1", type: "list_item", content: "milk",
            },
            {
              list_id: "grocery-list", list_name: "groceries", list_normalized_name: "groceries",
              list_summary: null, list_icon: "cart", list_list_type: "rolling",
              list_status: "active", list_embedding_model: null, list_metadata: {},
              list_created_at: "2026-01-01", list_updated_at: "2026-01-01",
              id: "i2", type: "list_item", content: "eggs",
            },
            {
              list_id: "book-list", list_name: "books", list_normalized_name: "books",
              list_summary: null, list_icon: "book", list_list_type: "rolling",
              list_status: "active", list_embedding_model: null, list_metadata: {},
              list_created_at: "2026-01-01", list_updated_at: "2026-01-01",
              id: "i3", type: "list_item", content: "dune",
            },
          ],
          rowCount: 3,
        }) // lists
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // pending

      const result = await getDashboard("2026-02-21");

      expect(query).toHaveBeenCalledTimes(5);

      // Lists grouped by list id with { list, items } structure
      expect(Object.keys(result.lists)).toHaveLength(2);
      expect(result.lists["grocery-list"].list.name).toBe("groceries");
      expect(result.lists["grocery-list"].items).toHaveLength(2);
      expect(result.lists["book-list"].list.name).toBe("books");
      expect(result.lists["book-list"].items).toHaveLength(1);

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
