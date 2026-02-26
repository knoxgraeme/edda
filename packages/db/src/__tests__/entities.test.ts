/**
 * Entity query function tests — upsert, update, search, link
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import {
  upsertEntity,
  updateEntity,
  getEntitiesByName,
  searchEntities,
  linkItemEntity,
  ENTITY_COLS,
} from "../entities.js";

vi.mock("../connection.js");

describe("entities", () => {
  let query: ReturnType<typeof mockGetPool>["query"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query } = mockGetPool());
  });

  describe("upsertEntity()", () => {
    it("ON CONFLICT increments mention_count and uses COALESCE for description/embedding", async () => {
      const fakeEntity = {
        id: "ent-1",
        name: "Acme Corp",
        type: "company",
        aliases: [],
        description: "A company",
        mention_count: 2,
      };
      query.mockResolvedValueOnce({ rows: [fakeEntity], rowCount: 1 });

      await upsertEntity({
        name: "Acme Corp",
        type: "company",
        description: "A company",
      });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("INSERT INTO entities");
      expect(sql).toContain("ON CONFLICT (name) DO UPDATE SET");
      expect(sql).toContain("mention_count = entities.mention_count + 1");
      expect(sql).toContain("COALESCE(EXCLUDED.description, entities.description)");
      expect(sql).toContain("COALESCE(EXCLUDED.embedding, entities.embedding)");
      expect(sql).toContain(`RETURNING ${ENTITY_COLS}`);
      expect(params).toEqual(["Acme Corp", "company", [], "A company", null, true, null]);
    });

    it("aliases default to empty array when not provided", async () => {
      query.mockResolvedValueOnce({ rows: [{ id: "ent-1" }], rowCount: 1 });

      await upsertEntity({ name: "Test", type: "person" });

      const [, params] = query.mock.calls[0];
      // params[2] is aliases
      expect(params[2]).toEqual([]);
    });
  });

  describe("updateEntity()", () => {
    it("column whitelist rejects unknown columns", async () => {
      // getEntityById fallback when no valid entries
      query.mockResolvedValueOnce({
        rows: [{ id: "ent-1", name: "Test" }],
        rowCount: 1,
      });

      const result = await updateEntity("ent-1", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["; DROP TABLE entities --" as any]: "evil",
      } as never);

      // Should fall through to getEntityById (no valid SET clauses)
      expect(query).toHaveBeenCalledOnce();
      const [sql] = query.mock.calls[0];
      expect(sql).toContain("SELECT");
      expect(sql).not.toContain("DROP");
      expect(result).toEqual({ id: "ent-1", name: "Test" });
    });

    it("Array values (aliases) are NOT JSON.stringify'd — passed as pg arrays", async () => {
      query.mockResolvedValueOnce({
        rows: [{ id: "ent-1", name: "Test", aliases: ["a", "b"] }],
        rowCount: 1,
      });

      await updateEntity("ent-1", { aliases: ["a", "b"] } as never);

      const [, params] = query.mock.calls[0];
      // aliases should be the raw array, not a JSON string
      const aliasParam = params.find(
        (p: unknown) => Array.isArray(p) && p.length === 2 && p[0] === "a",
      );
      expect(aliasParam).toEqual(["a", "b"]);
      expect(typeof aliasParam).not.toBe("string");
    });
  });

  describe("getEntitiesByName()", () => {
    it("uses ILIKE with %name% wildcard", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await getEntitiesByName("Acme");

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("ILIKE $1");
      expect(sql).toContain("ANY(aliases)");
      expect(params).toEqual(["%Acme%"]);
    });
  });

  describe("searchEntities()", () => {
    it("builds pgvector cosine distance query with optional type filter", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const embedding = [0.1, 0.2, 0.3];
      await searchEntities(embedding, { threshold: 0.7, limit: 10, type: "person" });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("WITH candidates AS");
      expect(sql).toContain("1 - (embedding <=> $1::vector)");
      expect(sql).toContain("type = $3");
      // Inner LIMIT $4, outer LIMIT $5
      expect(sql).toContain("LIMIT $4");
      expect(sql).toContain("LIMIT $5");
      expect(params).toEqual([JSON.stringify(embedding), 0.7, "person", 30, 10]);
    });

    it("omits type filter when not provided", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await searchEntities([0.1, 0.2], { limit: 5 });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("WITH candidates AS");
      expect(sql).not.toContain("type =");
      // Inner LIMIT $3, outer LIMIT $4
      expect(sql).toContain("LIMIT $3");
      expect(sql).toContain("LIMIT $4");
      expect(params).toEqual([JSON.stringify([0.1, 0.2]), 0.8, 15, 5]);
    });
  });

  describe("linkItemEntity()", () => {
    it("ON CONFLICT updates relationship", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await linkItemEntity("item-1", "ent-1", "related_to");

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("INSERT INTO item_entities");
      expect(sql).toContain("ON CONFLICT (item_id, entity_id) DO UPDATE SET relationship = $3");
      expect(params).toEqual(["item-1", "ent-1", "related_to"]);
    });
  });
});
