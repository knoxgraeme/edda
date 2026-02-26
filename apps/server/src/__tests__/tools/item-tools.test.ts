/**
 * Tool invocation tests — Item tools.
 *
 * Verifies that each tool calls the correct @edda/db function with correct args
 * and delegates embedding to the embed module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { ZERO_VECTOR, DEFAULT_SETTINGS } = vi.hoisted(() => ({
  ZERO_VECTOR: Object.freeze(new Array(1536).fill(0)) as readonly number[],
  DEFAULT_SETTINGS: {
    embedding_model: "voyage-3",
    embedding_dimensions: 1536,
    memory_reinforce_threshold: 0.95,
  },
}));

vi.mock("@edda/db", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  getItemById: vi.fn(),
  searchItems: vi.fn(),
  batchCreateItems: vi.fn(),
  getListItems: vi.fn(),
  getListByName: vi.fn(),
  getListById: vi.fn(),
  getAllLists: vi.fn(),
  getTimeline: vi.fn(),
  getAgentKnowledge: vi.fn(),
  getPendingItems: vi.fn(),
  getSettingsSync: vi.fn().mockReturnValue(DEFAULT_SETTINGS),
  getDashboard: vi.fn(),
  ITEM_COLS: "i.id, i.type, i.content",
}));

vi.mock("../../embed/index.js", () => ({
  embed: vi.fn().mockResolvedValue(ZERO_VECTOR),
  embedBatch: vi.fn().mockImplementation((texts: string[]) =>
    Promise.resolve(texts.map(() => ZERO_VECTOR)),
  ),
  buildEmbeddingText: vi.fn().mockImplementation(
    (type: string, content: string, summary?: string | null) =>
      `${type}: ${content}${summary ? `. ${summary}` : ""}`,
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
  getListById,
  getAllLists,
  getTimeline,
  getAgentKnowledge,
  getPendingItems,
} from "@edda/db";

import { embed, embedBatch, buildEmbeddingText } from "../../embed/index.js";

import { createItemTool } from "../../agent/tools/create-item.js";
import { batchCreateItemsTool } from "../../agent/tools/batch-create-items.js";
import { updateItemTool } from "../../agent/tools/update-item.js";
import { deleteItemTool } from "../../agent/tools/delete-item.js";
import { searchItemsTool } from "../../agent/tools/search-items.js";
import { getItemByIdTool } from "../../agent/tools/get-item-by-id.js";
import { getDailySummaryTool } from "../../agent/tools/get-daily-summary.js";
import { getListContentsTool } from "../../agent/tools/list-contents.js";
import { getTimelineTool } from "../../agent/tools/get-timeline.js";
import { listPendingItemsTool } from "../../agent/tools/list-pending-items.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createItemTool", () => {
  it("embeds content and calls createItem with embedding result", async () => {
    const fakeItem = {
      id: "00000000-0000-4000-8000-000000000001",
      type: "note",
      status: "active",
      day: "2026-02-21",
    };
    vi.mocked(createItem).mockResolvedValueOnce(fakeItem as never);

    const result = await createItemTool.invoke({ type: "note", content: "hello world" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(buildEmbeddingText)).toHaveBeenCalledWith("note", "hello world", undefined, null);
    expect(vi.mocked(embed)).toHaveBeenCalledWith("note: hello world");
    expect(vi.mocked(searchItems)).not.toHaveBeenCalled();
    expect(vi.mocked(createItem)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "note",
        content: "hello world",
        embedding: expect.any(Array),
        embedding_model: "voyage-3",
        source: "chat",
      }),
    );
    expect(parsed.id).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("batchCreateItemsTool", () => {
  it("calls embedBatch and batchCreateItems with array", async () => {
    const fakeItems = [
      { id: "00000000-0000-4000-8000-000000000010", type: "note" },
      { id: "00000000-0000-4000-8000-000000000011", type: "task" },
    ];
    vi.mocked(batchCreateItems).mockResolvedValueOnce(fakeItems as never);

    const result = await batchCreateItemsTool.invoke({
      items: [
        { type: "note", content: "first" },
        { type: "task", content: "second" },
      ],
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(embedBatch)).toHaveBeenCalledWith(["note: first", "task: second"]);
    expect(vi.mocked(batchCreateItems)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: "note", content: "first", source: "chat" }),
        expect.objectContaining({ type: "task", content: "second", source: "chat" }),
      ]),
    );
    expect(parsed.count).toBe(2);
    expect(parsed.item_ids).toEqual([
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
    ]);
  });
});

describe("updateItemTool", () => {
  it("calls updateItem and returns stringified result", async () => {
    const fakeItem = { id: "00000000-0000-4000-8000-000000000101", status: "done" };
    vi.mocked(updateItem).mockResolvedValueOnce(fakeItem as never);

    const result = await updateItemTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000101",
      status: "done",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(updateItem)).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000101",
      expect.objectContaining({ status: "done", completed_at: expect.any(String) }),
    );
    expect(parsed.item_id).toBe("00000000-0000-4000-8000-000000000101");
    expect(parsed.updated_fields).toContain("status");
    expect(parsed.updated_fields).toContain("completed_at");
  });

  it("re-embeds when content changes", async () => {
    const fakeItem = {
      id: "00000000-0000-4000-8000-000000000102",
      status: "active",
      type: "note",
      summary: "a summary",
    };
    vi.mocked(getItemById).mockResolvedValueOnce(fakeItem as never);
    vi.mocked(updateItem).mockResolvedValueOnce(fakeItem as never);

    await updateItemTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000102",
      content: "new text",
    });

    expect(vi.mocked(buildEmbeddingText)).toHaveBeenCalledWith("note", "new text", "a summary");
    expect(vi.mocked(embed)).toHaveBeenCalledWith("note: new text. a summary");
    expect(vi.mocked(updateItem)).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000102",
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

    const result = await deleteItemTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000201",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(deleteItem)).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000201");
    expect(parsed.status).toBe("deleted");
  });

  it("returns not_found when deleteItem returns false", async () => {
    vi.mocked(deleteItem).mockResolvedValueOnce(false as never);

    const result = await deleteItemTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000202",
    });
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe("not_found");
  });
});

describe("searchItemsTool", () => {
  it("embeds query text and calls searchItems with filters", async () => {
    vi.mocked(searchItems).mockResolvedValue([
      { id: "s-1", type: "note", content: "match", similarity: 0.9 },
    ] as never);

    const result = await searchItemsTool.invoke({
      query: "find this",
      type: "note",
      limit: 5,
    });
    const parsed = JSON.parse(result);

    // When type is provided, query is embedded in the same format as stored items
    expect(vi.mocked(embed)).toHaveBeenCalledWith("note: find this");
    expect(vi.mocked(searchItems)).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ limit: 5, type: "note" }),
    );
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].id).toBe("s-1");
  });

  it("falls back to listing mode when no query + agent_knowledge_only", async () => {
    vi.mocked(getAgentKnowledge).mockResolvedValueOnce([
      { id: "ak-1", type: "preference", content: "likes dark mode" },
    ] as never);

    const result = await searchItemsTool.invoke({
      agent_knowledge_only: true,
      order_by: "reinforced",
      limit: 10,
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(getAgentKnowledge)).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: "reinforced", limit: 10 }),
    );
    expect(vi.mocked(embed)).not.toHaveBeenCalled();
    expect(parsed.count).toBe(1);
  });

  it("returns error when no query and not in listing mode", async () => {
    const result = await searchItemsTool.invoke({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(parsed.count).toBe(0);
    expect(vi.mocked(embed)).not.toHaveBeenCalled();
  });
});

describe("read-only item tools", () => {
  it("getItemByIdTool calls getItemById", async () => {
    vi.mocked(getItemById).mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000301",
      type: "note",
      content: "content",
    } as never);

    const result = await getItemByIdTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000301",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(getItemById)).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000301");
    expect(parsed.found).toBe(true);
    expect(parsed.item.id).toBe("00000000-0000-4000-8000-000000000301");
  });

  it("getDailySummaryTool calls getDashboard", async () => {
    vi.mocked(getDashboard).mockResolvedValueOnce({ items: [] } as never);

    await getDailySummaryTool.invoke({ date: "2026-02-21" });

    expect(vi.mocked(getDashboard)).toHaveBeenCalledWith("2026-02-21");
  });

  it("getListContentsTool calls getListItems when list_id provided", async () => {
    const listId = "550e8400-e29b-41d4-a716-446655440000";
    const fakeList = {
      id: listId,
      name: "Grocery",
      summary: null,
      icon: "📋",
      list_type: "rolling",
      status: "active",
    };
    vi.mocked(getListById).mockResolvedValueOnce(fakeList as never);
    vi.mocked(getListItems).mockResolvedValueOnce([
      { id: "li-1", content: "buy milk" },
    ] as never);

    const result = await getListContentsTool.invoke({ list_id: listId });
    const parsed = JSON.parse(result);

    expect(vi.mocked(getListById)).toHaveBeenCalledWith(listId);
    expect(vi.mocked(getListItems)).toHaveBeenCalledWith(listId);
    expect(parsed.count).toBe(1);
  });

  it("getListContentsTool returns all lists when no args", async () => {
    vi.mocked(getAllLists).mockResolvedValueOnce([
      { id: "l-1", name: "Grocery", item_count: 3 },
    ] as never);

    const result = await getListContentsTool.invoke({});
    const parsed = JSON.parse(result);

    expect(vi.mocked(getAllLists)).toHaveBeenCalled();
    expect(parsed.count).toBe(1);
    expect(parsed.lists[0].name).toBe("Grocery");
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
});

describe("createItemTool — dedup", () => {
  it("does NOT call searchItems for non-knowledge types", async () => {
    const fakeItem = {
      id: "00000000-0000-4000-8000-000000000001",
      type: "note",
      status: "active",
      day: "2026-02-21",
    };
    vi.mocked(createItem).mockResolvedValueOnce(fakeItem as never);

    await createItemTool.invoke({ type: "note", content: "hello world" });

    expect(vi.mocked(searchItems)).not.toHaveBeenCalled();
  });

  it("calls searchItems for knowledge types and reinforces duplicates", async () => {
    const existingItem = {
      id: "00000000-0000-4000-8000-000000000002",
      type: "preference",
      status: "active",
      day: "2026-02-20",
      similarity: 0.96,
    };
    vi.mocked(searchItems).mockResolvedValueOnce([existingItem] as never);
    vi.mocked(updateItem).mockResolvedValueOnce(existingItem as never);

    const result = await createItemTool.invoke({
      type: "preference",
      content: "likes dark mode",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(searchItems)).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ type: "preference", confirmedOnly: false }),
    );
    expect(vi.mocked(updateItem)).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      expect.objectContaining({ last_reinforced_at: expect.any(String) }),
    );
    expect(parsed.reinforced).toBe(true);
  });

  it("skips reinforcement when match is done/archived", async () => {
    const archivedItem = {
      id: "00000000-0000-4000-8000-000000000003",
      type: "preference",
      status: "archived",
      day: "2026-02-20",
      similarity: 0.96,
    };
    vi.mocked(searchItems).mockResolvedValueOnce([archivedItem] as never);
    const fakeItem = {
      id: "00000000-0000-4000-8000-000000000004",
      type: "preference",
      status: "active",
      day: "2026-02-22",
    };
    vi.mocked(createItem).mockResolvedValueOnce(fakeItem as never);

    const result = await createItemTool.invoke({
      type: "preference",
      content: "likes dark mode",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(updateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(createItem)).toHaveBeenCalled();
    expect(parsed.id).toBe("00000000-0000-4000-8000-000000000004");
  });
});

describe("updateItemTool — edge cases", () => {
  it("returns error early when item not found during content update", async () => {
    vi.mocked(getItemById).mockResolvedValueOnce(null as never);

    const result = await updateItemTool.invoke({
      item_id: "00000000-0000-4000-8000-000000000099",
      content: "new text",
    });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe("Item not found");
    expect(vi.mocked(embed)).not.toHaveBeenCalled();
    expect(vi.mocked(updateItem)).not.toHaveBeenCalled();
  });
});

describe("listPendingItemsTool", () => {
  it("returns all pending items when table is 'all'", async () => {
    const fakePending = [
      {
        id: "00000000-0000-4000-8000-000000000090",
        table: "items",
        type: "note",
        label: "test",
        pendingAction: "review",
        createdAt: "2026-02-22",
      },
      {
        id: "00000000-0000-4000-8000-000000000091",
        table: "entities",
        type: "entity:person",
        label: "John",
        pendingAction: "confirm",
        createdAt: "2026-02-22",
      },
    ];
    vi.mocked(getPendingItems).mockResolvedValueOnce(fakePending as never);

    const result = await listPendingItemsTool.invoke({});
    const parsed = JSON.parse(result);

    expect(vi.mocked(getPendingItems)).toHaveBeenCalled();
    expect(parsed.count).toBe(2);
  });

  it("filters by table when specified", async () => {
    const fakePending = [
      {
        id: "00000000-0000-4000-8000-000000000090",
        table: "items",
        type: "note",
        label: "test",
        pendingAction: "review",
        createdAt: "2026-02-22",
      },
      {
        id: "00000000-0000-4000-8000-000000000091",
        table: "entities",
        type: "entity:person",
        label: "John",
        pendingAction: "confirm",
        createdAt: "2026-02-22",
      },
    ];
    vi.mocked(getPendingItems).mockResolvedValueOnce(fakePending as never);

    const result = await listPendingItemsTool.invoke({ table: "items" });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.pending[0].table).toBe("items");
  });
});
