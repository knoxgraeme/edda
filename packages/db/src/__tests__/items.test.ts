/**
 * Items query function tests — covers SQL construction, parameter binding,
 * column whitelist security, and transaction flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import {
  createItem,
  updateItem,
  deleteItem,
  searchItems,
  batchCreateItems,
  getAgentKnowledge,
  ITEM_COLS,
} from "../items.js";

vi.mock("../connection.js");

describe("items", () => {
  let query: ReturnType<typeof mockGetPool>["query"];
  let client: ReturnType<typeof mockGetPool>["client"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query, client } = mockGetPool());
  });

  // ── createItem ──────────────────────────────────────────────────

  describe("createItem", () => {
    it("binds 12 parameters in correct order and uses ITEM_COLS in RETURNING", async () => {
      const fakeItem = {
        id: "item-1",
        type: "note",
        content: "hello",
        summary: "sum",
        metadata: {},
        status: "active",
        source: "chat",
        day: "2026-02-21",
        confirmed: true,
        parent_id: null,
        embedding_model: null,
        pending_action: null,
        created_at: "2026-02-21",
        updated_at: "2026-02-21",
      };

      query.mockResolvedValueOnce({ rows: [fakeItem], rowCount: 1 });

      const result = await createItem({
        type: "note",
        content: "hello",
        summary: "sum",
        metadata: { key: "val" },
        status: "active",
        source: "chat",
        day: "2026-02-21",
        confirmed: true,
        parent_id: "parent-1",
        embedding: [0.1, 0.2],
        embedding_model: "voyage-3",
        pending_action: "review",
      });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];

      // SQL should contain RETURNING with ITEM_COLS
      expect(sql).toEqual(expect.stringContaining("INSERT INTO items"));
      expect(sql).toEqual(expect.stringContaining(`RETURNING ${ITEM_COLS}`));

      // 12 parameters in order
      expect(params).toHaveLength(12);
      expect(params[0]).toBe("note"); // type
      expect(params[1]).toBe("hello"); // content
      expect(params[2]).toBe("sum"); // summary
      expect(params[3]).toBe(JSON.stringify({ key: "val" })); // metadata serialized
      expect(params[4]).toBe("active"); // status
      expect(params[5]).toBe("chat"); // source
      expect(params[6]).toBe("2026-02-21"); // day
      expect(params[7]).toBe(true); // confirmed
      expect(params[8]).toBe("parent-1"); // parent_id
      expect(params[9]).toBe(JSON.stringify([0.1, 0.2])); // embedding serialized
      expect(params[10]).toBe("voyage-3"); // embedding_model
      expect(params[11]).toBe("review"); // pending_action

      expect(result).toEqual(fakeItem);
    });
  });

  // ── updateItem ──────────────────────────────────────────────────

  describe("updateItem", () => {
    it("P1 security: column whitelist rejects unknown columns", async () => {
      const fakeItem = { id: "item-1", type: "note", content: "existing" };
      query.mockResolvedValueOnce({ rows: [fakeItem], rowCount: 1 });

      // Attempt to inject a malicious column name — should be filtered out,
      // leaving no valid updates, so it falls through to getItemById
      await updateItem("item-1", {
        ['; DROP TABLE items --']: "pwned",
      } as never);

      // The only query should be a SELECT (getItemById fallback), not an UPDATE
      expect(query).toHaveBeenCalledOnce();
      const [sql] = query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining("SELECT"));
      expect(sql).not.toEqual(expect.stringContaining("UPDATE"));
      expect(sql).not.toEqual(expect.stringContaining("DROP"));
    });

    it("returns existing item via getItemById when updates are empty", async () => {
      const fakeItem = { id: "item-1", type: "note", content: "existing" };
      query.mockResolvedValueOnce({ rows: [fakeItem], rowCount: 1 });

      const result = await updateItem("item-1", {});

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining("SELECT"));
      expect(params).toEqual(["item-1"]);
      expect(result).toEqual(fakeItem);
    });

    it("JSON-serializes object values like metadata", async () => {
      const fakeItem = { id: "item-1", type: "note", metadata: { updated: true } };
      query.mockResolvedValueOnce({ rows: [fakeItem], rowCount: 1 });

      await updateItem("item-1", {
        metadata: { updated: true } as Record<string, unknown>,
      });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining("UPDATE items SET"));
      // First param is id, second is the serialized metadata
      expect(params[0]).toBe("item-1");
      expect(params[1]).toBe(JSON.stringify({ updated: true }));
    });
  });

  // ── deleteItem ──────────────────────────────────────────────────

  describe("deleteItem", () => {
    it("returns true when rowCount > 0, false when 0", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      expect(await deleteItem("item-1")).toBe(true);

      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      expect(await deleteItem("item-2")).toBe(false);
    });
  });

  // ── searchItems ─────────────────────────────────────────────────

  describe("searchItems", () => {
    it("builds pgvector cosine distance query with threshold", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await searchItems([0.1, 0.2, 0.3], { threshold: 0.9, limit: 5 });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining("1 - (embedding <=> $1::vector)"));
      expect(sql).toEqual(expect.stringContaining("ORDER BY similarity DESC"));
      expect(params[0]).toBe(JSON.stringify([0.1, 0.2, 0.3])); // embedding
      expect(params[1]).toBe(0.9); // threshold
      expect(params[2]).toBe(5); // limit (at end)
    });

    it("adds optional filters for type, after date, and agentKnowledgeOnly", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await searchItems([0.1], {
        type: "note",
        after: "2026-01-01",
        agentKnowledgeOnly: true,
      });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining("type = $3"));
      expect(sql).toEqual(expect.stringContaining("day >= $4::date"));
      expect(sql).toEqual(
        expect.stringContaining("type IN ('preference', 'learned_fact', 'pattern')"),
      );
      expect(params[2]).toBe("note");
      expect(params[3]).toBe("2026-01-01");
    });

    it("increments parameter indices correctly across optional filters", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // With type + after, LIMIT should be $5
      await searchItems([0.1], { type: "note", after: "2026-01-01", limit: 20 });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining("LIMIT $5"));
      // params: [embedding, threshold, type, after, limit]
      expect(params).toHaveLength(5);
      expect(params[4]).toBe(20);
    });
  });

  // ── batchCreateItems ────────────────────────────────────────────

  describe("batchCreateItems", () => {
    it("calls BEGIN, per-item INSERT, COMMIT via pool.connect()", async () => {
      const fakeItems = [
        { id: "1", type: "note", content: "a" },
        { id: "2", type: "note", content: "b" },
      ];

      client.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [fakeItems[0]], rowCount: 1 }) // INSERT 1
        .mockResolvedValueOnce({ rows: [fakeItems[1]], rowCount: 1 }) // INSERT 2
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const result = await batchCreateItems([
        { type: "note", content: "a" },
        { type: "note", content: "b" },
      ]);

      // Verify transaction flow
      expect(client.query).toHaveBeenCalledWith("BEGIN");
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO items"),
        expect.any(Array),
      );
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.release).toHaveBeenCalled();

      // 4 calls total: BEGIN + 2 INSERTS + COMMIT
      expect(client.query).toHaveBeenCalledTimes(4);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(fakeItems[0]);
      expect(result[1]).toEqual(fakeItems[1]);
    });
  });

  // ── getAgentKnowledge ───────────────────────────────────────────

  describe("getAgentKnowledge", () => {
    it("ORDER_BY_MAP whitelist: known keys produce valid SQL, unknown falls back", async () => {
      const knownKeys = [
        { key: "recent", expected: "created_at DESC" },
        { key: "reinforced", expected: "COALESCE(last_reinforced_at, updated_at) DESC" },
        { key: "updated", expected: "updated_at DESC" },
      ];

      for (const { key, expected } of knownKeys) {
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        await getAgentKnowledge({ orderBy: key });

        const [sql] = query.mock.calls[query.mock.calls.length - 1];
        expect(sql).toEqual(expect.stringContaining(`ORDER BY ${expected}`));
      }

      // Unknown key falls back to "reinforced"
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await getAgentKnowledge({ orderBy: "'; DROP TABLE items --" });

      const [sql] = query.mock.calls[query.mock.calls.length - 1];
      expect(sql).toEqual(
        expect.stringContaining("ORDER BY COALESCE(last_reinforced_at, updated_at) DESC"),
      );
      expect(sql).not.toEqual(expect.stringContaining("DROP"));
    });
  });
});
