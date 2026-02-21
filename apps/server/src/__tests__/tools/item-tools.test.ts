/**
 * Tool invocation tests — Item tools.
 *
 * Verifies that each tool calls the correct @edda/db function with correct args
 * and delegates embedding to the embed module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { ZERO_VECTOR, DEFAULT_SETTINGS } = vi.hoisted(() => ({
  ZERO_VECTOR: Object.freeze(new Array(1536).fill(0)) as readonly number[],
  DEFAULT_SETTINGS: { embedding_model: "voyage-3", embedding_dimensions: 1536 },
}));

vi.mock("@edda/db", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  getItemById: vi.fn(),
  searchItems: vi.fn(),
  batchCreateItems: vi.fn(),
  getListItems: vi.fn(),
  getTimeline: vi.fn(),
  getAgentKnowledge: vi.fn(),
  getSettingsSync: vi.fn().mockReturnValue(DEFAULT_SETTINGS),
  getDashboard: vi.fn(),
  ITEM_COLS: "i.id, i.type, i.content",
}));

vi.mock("../../embed/index.js", () => ({
  embed: vi.fn().mockResolvedValue(ZERO_VECTOR),
  embedBatch: vi.fn().mockImplementation((texts: string[]) =>
    Promise.resolve(texts.map(() => ZERO_VECTOR)),
  ),
}));

import {
  createItem,
  batchCreateItems,
  updateItem,
  deleteItem,
  searchItems,
  getItemById,
  getDashboard,
  getListItems,
  getTimeline,
  getAgentKnowledge,
} from "@edda/db";

import { embed, embedBatch } from "../../embed/index.js";

import { createItemTool } from "../../agent/tools/create-item.js";
import { batchCreateItemsTool } from "../../agent/tools/batch-create-items.js";
import { updateItemTool } from "../../agent/tools/update-item.js";
import { deleteItemTool } from "../../agent/tools/delete-item.js";
import { searchItemsTool } from "../../agent/tools/search-items.js";
import { getItemByIdTool } from "../../agent/tools/get-item-by-id.js";
import { getDashboardTool } from "../../agent/tools/get-dashboard.js";
import { getListItemsTool } from "../../agent/tools/get-list-items.js";
import { getTimelineTool } from "../../agent/tools/get-timeline.js";
import { getAgentKnowledgeTool } from "../../agent/tools/get-agent-knowledge.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createItemTool", () => {
  it("embeds content and calls createItem with embedding result", async () => {
    const fakeItem = { id: "item-1", type: "note", status: "active", day: "2026-02-21" };
    vi.mocked(createItem).mockResolvedValueOnce(fakeItem as never);

    const result = await createItemTool.invoke({ type: "note", content: "hello world" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(embed)).toHaveBeenCalledWith("hello world");
    expect(vi.mocked(createItem)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "note",
        content: "hello world",
        embedding: expect.any(Array),
        embedding_model: "voyage-3",
        source: "chat",
      }),
    );
    expect(parsed.id).toBe("item-1");
  });
});

describe("batchCreateItemsTool", () => {
  it("calls embedBatch and batchCreateItems with array", async () => {
    const fakeItems = [
      { id: "b-1", type: "note" },
      { id: "b-2", type: "task" },
    ];
    vi.mocked(batchCreateItems).mockResolvedValueOnce(fakeItems as never);

    const result = await batchCreateItemsTool.invoke({
      items: [
        { type: "note", content: "first" },
        { type: "task", content: "second" },
      ],
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(embedBatch)).toHaveBeenCalledWith(["first", "second"]);
    expect(vi.mocked(batchCreateItems)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: "note", content: "first", source: "chat" }),
        expect.objectContaining({ type: "task", content: "second", source: "chat" }),
      ]),
    );
    expect(parsed.count).toBe(2);
    expect(parsed.item_ids).toEqual(["b-1", "b-2"]);
  });
});

describe("updateItemTool", () => {
  it("calls updateItem and returns stringified result", async () => {
    const fakeItem = { id: "u-1", status: "done" };
    vi.mocked(updateItem).mockResolvedValueOnce(fakeItem as never);

    const result = await updateItemTool.invoke({ item_id: "u-1", status: "done" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(updateItem)).toHaveBeenCalledWith(
      "u-1",
      expect.objectContaining({ status: "done", completed_at: expect.any(String) }),
    );
    expect(parsed.item_id).toBe("u-1");
    expect(parsed.updated_fields).toContain("status");
    expect(parsed.updated_fields).toContain("completed_at");
  });

  it("re-embeds when content changes", async () => {
    const fakeItem = { id: "u-2", status: "active" };
    vi.mocked(updateItem).mockResolvedValueOnce(fakeItem as never);

    await updateItemTool.invoke({ item_id: "u-2", content: "new text" });

    expect(vi.mocked(embed)).toHaveBeenCalledWith("new text");
    expect(vi.mocked(updateItem)).toHaveBeenCalledWith(
      "u-2",
      expect.objectContaining({
        content: "new text",
        embedding: expect.any(Array),
        embedding_model: "voyage-3",
      }),
    );
  });
});

describe("deleteItemTool", () => {
  it("calls deleteItem with the provided ID", async () => {
    vi.mocked(deleteItem).mockResolvedValueOnce(true as never);

    const result = await deleteItemTool.invoke({ item_id: "del-1" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(deleteItem)).toHaveBeenCalledWith("del-1");
    expect(parsed.status).toBe("deleted");
  });

  it("returns not_found when deleteItem returns false", async () => {
    vi.mocked(deleteItem).mockResolvedValueOnce(false as never);

    const result = await deleteItemTool.invoke({ item_id: "del-missing" });
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe("not_found");
  });
});

describe("searchItemsTool", () => {
  it("embeds query text and calls searchItems with filters", async () => {
    vi.mocked(searchItems).mockResolvedValueOnce([
      { id: "s-1", type: "note", content: "match", similarity: 0.9 },
    ] as never);

    const result = await searchItemsTool.invoke({
      query: "find this",
      type: "note",
      limit: 5,
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(embed)).toHaveBeenCalledWith("find this");
    expect(vi.mocked(searchItems)).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ limit: 5, type: "note" }),
    );
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].id).toBe("s-1");
  });
});

describe("read-only item tools", () => {
  it("getItemByIdTool calls getItemById", async () => {
    vi.mocked(getItemById).mockResolvedValueOnce({
      id: "r-1",
      type: "note",
      content: "content",
    } as never);

    const result = await getItemByIdTool.invoke({ item_id: "r-1" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(getItemById)).toHaveBeenCalledWith("r-1");
    expect(parsed.found).toBe(true);
    expect(parsed.item.id).toBe("r-1");
  });

  it("getDashboardTool calls getDashboard", async () => {
    vi.mocked(getDashboard).mockResolvedValueOnce({ items: [] } as never);

    await getDashboardTool.invoke({ date: "2026-02-21" });

    expect(vi.mocked(getDashboard)).toHaveBeenCalledWith("2026-02-21");
  });

  it("getListItemsTool calls getListItems", async () => {
    vi.mocked(getListItems).mockResolvedValueOnce([
      { id: "li-1", content: "buy milk" },
    ] as never);

    const result = await getListItemsTool.invoke({ list_name: "groceries" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(getListItems)).toHaveBeenCalledWith("groceries");
    expect(parsed.count).toBe(1);
  });

  it("getTimelineTool calls getTimeline", async () => {
    vi.mocked(getTimeline).mockResolvedValueOnce([{ id: "t-1" }] as never);

    const result = await getTimelineTool.invoke({
      start: "2026-02-01",
      end: "2026-02-28",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(getTimeline)).toHaveBeenCalledWith(
      "2026-02-01",
      "2026-02-28",
      undefined,
      undefined,
    );
    expect(parsed.count).toBe(1);
  });

  it("getAgentKnowledgeTool calls getAgentKnowledge", async () => {
    vi.mocked(getAgentKnowledge).mockResolvedValueOnce([{ id: "ak-1" }] as never);

    const result = await getAgentKnowledgeTool.invoke({});
    const parsed = JSON.parse(result);

    expect(vi.mocked(getAgentKnowledge)).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: undefined, limit: undefined }),
    );
    expect(parsed.count).toBe(1);
  });
});
