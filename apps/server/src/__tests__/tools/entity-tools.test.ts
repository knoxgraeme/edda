/**
 * Tool invocation tests — Entity tools.
 *
 * Verifies that entity tools call the correct @edda/db functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { ZERO_VECTOR } = vi.hoisted(() => ({
  ZERO_VECTOR: Object.freeze(new Array(1536).fill(0)) as readonly number[],
}));

vi.mock("@edda/db", () => ({
  upsertEntity: vi.fn(),
  linkItemEntity: vi.fn(),
  resolveEntity: vi.fn(),
  getEntityItems: vi.fn(),
  getSettingsSync: vi.fn().mockReturnValue({ embedding_model: "voyage-3" }),
  ENTITY_COLS: "e.id, e.name, e.type",
}));

vi.mock("../../embed/index.js", () => ({
  embed: vi.fn().mockResolvedValue(ZERO_VECTOR),
}));

import { upsertEntity, linkItemEntity, resolveEntity, getEntityItems } from "@edda/db";
import { embed } from "../../embed/index.js";

import { upsertEntityTool } from "../../agent/tools/upsert-entity.js";
import { linkItemEntityTool } from "../../agent/tools/link-item-entity.js";
import { listEntityItemsTool } from "../../agent/tools/list-entity-items.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertEntityTool", () => {
  it("embeds entity info and calls upsertEntity", async () => {
    vi.mocked(upsertEntity).mockResolvedValueOnce({ id: "ent-1" } as never);

    const result = await upsertEntityTool.invoke({
      name: "Acme Corp",
      type: "company",
      description: "A company",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(embed)).toHaveBeenCalledWith("company: Acme Corp. A company");
    expect(vi.mocked(upsertEntity)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme Corp",
        type: "company",
        description: "A company",
        embedding: expect.any(Array),
      }),
    );
    expect(parsed.entity_id).toBe("ent-1");
    expect(parsed.status).toBe("upserted");
  });

  it("handles missing description in embed text", async () => {
    vi.mocked(upsertEntity).mockResolvedValueOnce({ id: "ent-2" } as never);

    await upsertEntityTool.invoke({ name: "Alice", type: "person" });

    expect(vi.mocked(embed)).toHaveBeenCalledWith("person: Alice. ");
  });
});

describe("linkItemEntityTool", () => {
  it("calls linkItemEntity with correct args", async () => {
    vi.mocked(linkItemEntity).mockResolvedValueOnce(undefined as never);

    const result = await linkItemEntityTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000001",
      entity_id: "00000000-0000-4000-8000-000000000010",
      relationship: "about",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(linkItemEntity)).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000010",
      "about",
    );
    expect(parsed.status).toBe("linked");
  });

  it("defaults relationship to mentioned", async () => {
    vi.mocked(linkItemEntity).mockResolvedValueOnce(undefined as never);

    await linkItemEntityTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000002",
      entity_id: "00000000-0000-4000-8000-000000000020",
    });

    expect(vi.mocked(linkItemEntity)).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000020",
      "mentioned",
    );
  });
});

describe("listEntityItemsTool", () => {
  it("resolves entity by name then fetches items", async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({ id: "ent-1", name: "Alice" } as never);
    vi.mocked(getEntityItems).mockResolvedValueOnce([{ id: "item-1" }] as never);

    const result = await listEntityItemsTool.invoke({ name: "Alice", limit: 10 });
    const parsed = JSON.parse(result);

    expect(vi.mocked(resolveEntity)).toHaveBeenCalledWith("Alice");
    expect(vi.mocked(getEntityItems)).toHaveBeenCalledWith("ent-1", { limit: 10 });
    expect(parsed.entity.id).toBe("ent-1");
    expect(parsed.items).toHaveLength(1);
  });

  it("returns not found when entity does not exist", async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce(null as never);

    const result = await listEntityItemsTool.invoke({ name: "Unknown", limit: 20 });
    const parsed = JSON.parse(result);

    expect(parsed.found).toBe(false);
    expect(vi.mocked(getEntityItems)).not.toHaveBeenCalled();
  });
});
