/**
 * Dashboard query function tests — parallel queries, list grouping, pending counts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import { getDashboard, getPendingConfirmationsCount } from "../dashboard.js";

vi.mock("../connection.js");

/** Helper to build a mock row returned by the lists LEFT JOIN query */
function listRow(
  listFields: {
    id: string;
    name: string;
    normalized_name?: string;
    icon?: string;
    list_type?: string;
  },
  itemFields?: { id: string; type: string; content: string; list_id?: string },
) {
  return {
    // _l_ prefixed list columns (as aliased in the SQL)
    _l_id: listFields.id,
    _l_name: listFields.name,
    _l_normalized_name: listFields.normalized_name ?? listFields.name,
    _l_summary: null,
    _l_icon: listFields.icon ?? "list",
    _l_list_type: listFields.list_type ?? "rolling",
    _l_status: "active",
    _l_embedding_model: null,
    _l_metadata: {},
    _l_created_at: "2026-01-01",
    _l_updated_at: "2026-01-01",
    // item columns — NULL when LEFT JOIN produces no match
    id: itemFields?.id ?? null,
    type: itemFields?.type ?? null,
    content: itemFields?.content ?? null,
    list_id: itemFields?.list_id ?? itemFields ? listFields.id : null,
  };
}

describe("dashboard", () => {
  let query: ReturnType<typeof mockGetPool>["query"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query } = mockGetPool());
  });

  describe("getDashboard()", () => {
    it("fires 5 parallel queries and groups list items by list id", async () => {
      // 5 queries: dueToday, capturedToday, openItems, lists (LEFT JOIN), pending
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dueToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // capturedToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // openItems
        .mockResolvedValueOnce({
          rows: [
            listRow(
              { id: "grocery-list", name: "groceries", icon: "cart" },
              { id: "i1", type: "list_item", content: "milk" },
            ),
            listRow(
              { id: "grocery-list", name: "groceries", icon: "cart" },
              { id: "i2", type: "list_item", content: "eggs" },
            ),
            listRow(
              { id: "book-list", name: "books", icon: "book" },
              { id: "i3", type: "list_item", content: "dune" },
            ),
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

    it("includes empty lists from LEFT JOIN with zero items", async () => {
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dueToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // capturedToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // openItems
        .mockResolvedValueOnce({
          rows: [
            // A list with one item
            listRow(
              { id: "grocery-list", name: "groceries", icon: "cart" },
              { id: "i1", type: "list_item", content: "milk" },
            ),
            // An empty list — LEFT JOIN produces NULL item columns
            listRow({ id: "empty-list", name: "empty", icon: "box" }),
          ],
          rowCount: 2,
        }) // lists
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // pending

      const result = await getDashboard("2026-02-21");

      // Both lists should appear
      expect(Object.keys(result.lists)).toHaveLength(2);

      // Populated list has its item
      expect(result.lists["grocery-list"].items).toHaveLength(1);

      // Empty list appears with an empty items array
      expect(result.lists["empty-list"]).toBeDefined();
      expect(result.lists["empty-list"].list.name).toBe("empty");
      expect(result.lists["empty-list"].items).toEqual([]);
    });

    it("item objects do not contain _l_ prefixed list properties", async () => {
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dueToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // capturedToday
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // openItems
        .mockResolvedValueOnce({
          rows: [
            listRow(
              { id: "grocery-list", name: "groceries", icon: "cart" },
              { id: "i1", type: "list_item", content: "milk" },
            ),
          ],
          rowCount: 1,
        }) // lists
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // pending

      const result = await getDashboard("2026-02-21");

      const item = result.lists["grocery-list"].items[0];
      const itemKeys = Object.keys(item);

      // No _l_ prefixed keys should leak into item objects
      const leakedKeys = itemKeys.filter((k) => k.startsWith("_l_"));
      expect(leakedKeys).toEqual([]);

      // Item should have its own properties
      expect(item.id).toBe("i1");
      expect(item.content).toBe("milk");
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

    it("uses LEFT JOIN for lists query", async () => {
      query.mockResolvedValue({ rows: [], rowCount: 0 });

      await getDashboard("2026-02-21");

      // The 4th query (index 3) is the lists query — should use LEFT JOIN
      const listsSql = query.mock.calls[3][0] as string;
      expect(listsSql).toContain("LEFT JOIN items");
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
