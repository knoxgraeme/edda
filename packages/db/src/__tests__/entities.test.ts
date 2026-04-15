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
  getGraphData,
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

  describe("getGraphData()", () => {
    const baseEntityRow = {
      id: "e1",
      name: "Acme Corp",
      type: "company",
      aliases: [],
      description: "A test company",
      mention_count: 5,
      last_seen_at: new Date("2025-01-10T12:00:00Z"),
      created_at: new Date("2024-06-01T00:00:00Z"),
    };

    const baseLinkRow = {
      item_id: "i1",
      entity_id: "e1",
      relationship: "mentioned",
      item_type: "note",
      item_content: "test content",
      item_summary: "Test note",
      item_created_at: new Date("2025-01-05T09:00:00Z"),
      item_last_reinforced_at: null,
    };

    it("empty result — returns empty graph when entity query returns no rows", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await getGraphData();

      expect(result).toEqual({ nodes: [], links: [], stats: { items_considered: 0, items_hidden_by_min_links: 0 } });
      // Only the entity query fires; no link/count queries needed
      expect(query).toHaveBeenCalledOnce();
    });

    it("itemsPerEntity=0 short-circuit — returns entity nodes only without further queries", async () => {
      const entityRows = [
        baseEntityRow,
        {
          ...baseEntityRow,
          id: "e2",
          name: "Beta Inc",
          type: "company",
          mention_count: 3,
        },
      ];
      query.mockResolvedValueOnce({ rows: entityRows, rowCount: entityRows.length });

      const result = await getGraphData({ itemsPerEntity: 0 });

      expect(result.nodes).toHaveLength(2);
      expect(result.links).toHaveLength(0);
      expect(result.nodes[0].kind).toBe("entity");
      expect(result.nodes[1].kind).toBe("entity");
      // No follow-up queries for links or counts
      expect(query).toHaveBeenCalledOnce();
    });

    it("full path — returns entity + item nodes, link, and stats", async () => {
      query
        .mockResolvedValueOnce({ rows: [baseEntityRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [baseLinkRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ item_id: "i1", total_links: 3 }], rowCount: 1 });

      const result = await getGraphData();

      // Two nodes: 1 entity + 1 item
      expect(result.nodes).toHaveLength(2);

      const entityNode = result.nodes.find((n) => n.kind === "entity");
      expect(entityNode).toBeDefined();
      expect(entityNode!.id).toBe("e1");
      expect(entityNode!.label).toBe("Acme Corp");
      expect(entityNode!.group).toBe("company");

      const itemNode = result.nodes.find((n) => n.kind === "item");
      expect(itemNode).toBeDefined();
      expect(itemNode!.id).toBe("i1");
      expect(itemNode!.kind).toBe("item");
      expect(itemNode!.weight).toBe(3);

      // One link from entity → item
      expect(result.links).toHaveLength(1);
      expect(result.links[0]).toEqual({ source: "e1", target: "i1", relationship: "mentioned" });

      // Stats
      expect(result.stats?.items_considered).toBe(1);
      expect(result.stats?.items_hidden_by_min_links).toBe(0);

      expect(query).toHaveBeenCalledTimes(3);
    });

    it("minItemLinks culling — drops items below threshold and records hidden count", async () => {
      const linkRow2 = { ...baseLinkRow, item_id: "i2" };
      query
        .mockResolvedValueOnce({ rows: [baseEntityRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [baseLinkRow, linkRow2], rowCount: 2 })
        .mockResolvedValueOnce({
          rows: [
            { item_id: "i1", total_links: 1 },
            { item_id: "i2", total_links: 3 },
          ],
          rowCount: 2,
        });

      const result = await getGraphData({ minItemLinks: 2 });

      // Only i2 survives (total_links=3 >= 2); i1 is culled (total_links=1 < 2)
      const itemNodes = result.nodes.filter((n) => n.kind === "item");
      expect(itemNodes).toHaveLength(1);
      expect(itemNodes[0].id).toBe("i2");

      // Link to i1 is also dropped
      expect(result.links).toHaveLength(1);
      expect(result.links[0].target).toBe("i2");

      expect(result.stats?.items_considered).toBe(2);
      expect(result.stats?.items_hidden_by_min_links).toBe(1);
    });

    it("type filter — passes types array as SQL ANY parameter", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await getGraphData({ types: ["person", "company"] });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("type = ANY($2::text[])");
      expect(params).toContainEqual(["person", "company"]);
    });

    it("search filter — escapes ILIKE metacharacters before inserting into params", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await getGraphData({ search: "test%query" });

      expect(query).toHaveBeenCalledOnce();
      const [, params] = query.mock.calls[0];
      // The % in the search term must be escaped to \% so it matches literally
      expect(params).toContain("%test\\%query%");
    });

    it("label truncation — item labels longer than 80 chars are sliced with ellipsis", async () => {
      const longContent = "a".repeat(100);
      const longLinkRow = { ...baseLinkRow, item_content: longContent, item_summary: "" };
      query
        .mockResolvedValueOnce({ rows: [baseEntityRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [longLinkRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ item_id: "i1", total_links: 1 }], rowCount: 1 });

      const result = await getGraphData();

      const itemNode = result.nodes.find((n) => n.kind === "item");
      expect(itemNode).toBeDefined();
      expect(itemNode!.label).toHaveLength(80);
      expect(itemNode!.label.endsWith("...")).toBe(true);
    });
  });
});
