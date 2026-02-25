/**
 * Phase 4: Tool Zod schema validation tests.
 *
 * Validates every tool's exported Zod schema accepts valid inputs
 * and rejects invalid ones. Pure schema testing -- no tool invocation.
 */

import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

import { addMcpConnectionSchema } from "../../agent/tools/add-mcp-connection.js";
import { batchCreateItemsSchema } from "../../agent/tools/batch-create-items.js";
import { confirmPendingSchema } from "../../agent/tools/confirm-pending.js";
import { getPendingItemsSchema } from "../../agent/tools/get-pending-items.js";
import { createItemTypeSchema } from "../../agent/tools/create-item-type.js";
import { createItemSchema } from "../../agent/tools/create-item.js";
import { deleteItemSchema } from "../../agent/tools/delete-item.js";
import { getAgentKnowledgeSchema } from "../../agent/tools/get-agent-knowledge.js";
import { getDashboardSchema } from "../../agent/tools/get-dashboard.js";
import { getEntityItemsSchema } from "../../agent/tools/get-entity-items.js";
import { getItemByIdSchema } from "../../agent/tools/get-item-by-id.js";
import { getListItemsSchema } from "../../agent/tools/get-list-items.js";
import { getSettingsSchema } from "../../agent/tools/get-settings.js";
import { getTimelineSchema } from "../../agent/tools/get-timeline.js";
import { linkItemEntitySchema } from "../../agent/tools/link-item-entity.js";
import { listMcpConnectionsSchema } from "../../agent/tools/list-mcp-connections.js";
import { rejectPendingSchema } from "../../agent/tools/reject-pending.js";
import { removeMcpConnectionSchema } from "../../agent/tools/remove-mcp-connection.js";
import { searchItemsSchema } from "../../agent/tools/search-items.js";
import { updateItemSchema } from "../../agent/tools/update-item.js";
import { updateMcpConnectionSchema } from "../../agent/tools/update-mcp-connection.js";
import { updateSettingsSchema } from "../../agent/tools/update-settings.js";
import { upsertEntitySchema } from "../../agent/tools/upsert-entity.js";

// ---------------------------------------------------------------------------
// add-mcp-connection
// ---------------------------------------------------------------------------
describe("addMcpConnectionSchema", () => {
  it("accepts valid input", () => {
    const result = addMcpConnectionSchema.parse({
      name: "My MCP Server",
      url: "https://mcp.example.com/sse",
    });
    expect(result.name).toBe("My MCP Server");
    expect(result.url).toBe("https://mcp.example.com/sse");
  });

  it("accepts optional fields", () => {
    const result = addMcpConnectionSchema.parse({
      name: "My MCP Server",
      url: "https://mcp.example.com/sse",
      description: "A test server",
      auth_env_var: "MCP_TOKEN",
    });
    expect(result.description).toBe("A test server");
    expect(result.auth_env_var).toBe("MCP_TOKEN");
  });

  it("rejects missing required fields", () => {
    expect(() => addMcpConnectionSchema.parse({})).toThrow(ZodError);
    expect(() => addMcpConnectionSchema.parse({ name: "test" })).toThrow(ZodError);
  });

  it("rejects invalid url", () => {
    expect(() =>
      addMcpConnectionSchema.parse({ name: "test", url: "not-a-url" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// batch-create-items
// ---------------------------------------------------------------------------
describe("batchCreateItemsSchema", () => {
  it("accepts valid input", () => {
    const result = batchCreateItemsSchema.parse({
      items: [{ content: "Item 1", type: "note" }],
    });
    expect(result.items).toHaveLength(1);
  });

  it("rejects missing items", () => {
    expect(() => batchCreateItemsSchema.parse({})).toThrow(ZodError);
  });

  it("rejects empty items array", () => {
    expect(() => batchCreateItemsSchema.parse({ items: [] })).toThrow(ZodError);
  });

  it("rejects items with missing required fields", () => {
    expect(() =>
      batchCreateItemsSchema.parse({ items: [{ content: "no type" }] }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// confirm-pending
// ---------------------------------------------------------------------------
describe("confirmPendingSchema", () => {
  it("accepts valid input", () => {
    const result = confirmPendingSchema.parse({ table: "items", id: "abc-123" });
    expect(result.table).toBe("items");
  });

  it("rejects missing fields", () => {
    expect(() => confirmPendingSchema.parse({})).toThrow(ZodError);
  });

  it("rejects invalid table enum value", () => {
    expect(() =>
      confirmPendingSchema.parse({ table: "users", id: "abc" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// create-item-type
// ---------------------------------------------------------------------------
describe("createItemTypeSchema", () => {
  it("accepts valid input", () => {
    const result = createItemTypeSchema.parse({
      name: "recipe",
      description: "A cooking recipe",
      classification_hint: "Use when the user shares a recipe or cooking instructions.",
    });
    expect(result.name).toBe("recipe");
  });

  it("accepts optional fields", () => {
    const result = createItemTypeSchema.parse({
      name: "recipe",
      description: "A cooking recipe",
      classification_hint: "Use when the user shares a recipe or cooking instructions.",
      icon: "🍳",
      metadata_schema: { type: "object" },
    });
    expect(result.icon).toBe("🍳");
  });

  it("rejects missing required fields", () => {
    expect(() => createItemTypeSchema.parse({ name: "recipe" })).toThrow(ZodError);
  });

  it("rejects wrong types", () => {
    expect(() =>
      createItemTypeSchema.parse({
        name: 123,
        description: "test",
        classification_hint: "test",
      }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// create-item
// ---------------------------------------------------------------------------
describe("createItemSchema", () => {
  it("accepts valid input", () => {
    const result = createItemSchema.parse({ type: "note", content: "Hello world" });
    expect(result.type).toBe("note");
    expect(result.content).toBe("Hello world");
  });

  it("accepts optional fields", () => {
    const result = createItemSchema.parse({
      type: "task",
      content: "Do something",
      summary: "task summary",
      day: "2026-01-15",
      status: "active",
      parent_id: "parent-123",
      metadata: { priority: "high" },
    });
    expect(result.status).toBe("active");
  });

  it("rejects missing required fields", () => {
    expect(() => createItemSchema.parse({ type: "note" })).toThrow(ZodError);
  });

  it("rejects invalid status enum", () => {
    expect(() =>
      createItemSchema.parse({ type: "note", content: "x", status: "invalid" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// delete-item
// ---------------------------------------------------------------------------
describe("deleteItemSchema", () => {
  it("accepts valid input", () => {
    const result = deleteItemSchema.parse({ item_id: "00000000-0000-4000-8000-000000000001" });
    expect(result.item_id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("rejects missing item_id", () => {
    expect(() => deleteItemSchema.parse({})).toThrow(ZodError);
  });

  it("rejects wrong type", () => {
    expect(() => deleteItemSchema.parse({ item_id: 123 })).toThrow(ZodError);
  });

  it("rejects non-UUID string", () => {
    expect(() => deleteItemSchema.parse({ item_id: "not-a-uuid" })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// get-agent-knowledge
// ---------------------------------------------------------------------------
describe("getAgentKnowledgeSchema", () => {
  it("accepts empty input (all optional)", () => {
    const result = getAgentKnowledgeSchema.parse({});
    expect(result).toBeDefined();
  });

  it("accepts valid optional fields", () => {
    const result = getAgentKnowledgeSchema.parse({ order_by: "reinforced", limit: 50 });
    expect(result.order_by).toBe("reinforced");
    expect(result.limit).toBe(50);
  });

  it("rejects invalid order_by enum", () => {
    expect(() => getAgentKnowledgeSchema.parse({ order_by: "alphabetical" })).toThrow(
      ZodError,
    );
  });
});

// ---------------------------------------------------------------------------
// get-dashboard
// ---------------------------------------------------------------------------
describe("getDashboardSchema", () => {
  it("accepts empty input", () => {
    const result = getDashboardSchema.parse({});
    expect(result).toBeDefined();
  });

  it("accepts valid date", () => {
    const result = getDashboardSchema.parse({ date: "2026-02-21" });
    expect(result.date).toBe("2026-02-21");
  });

  it("rejects wrong type for date", () => {
    expect(() => getDashboardSchema.parse({ date: 12345 })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// get-entity-items
// ---------------------------------------------------------------------------
describe("getEntityItemsSchema", () => {
  it("accepts valid input", () => {
    const result = getEntityItemsSchema.parse({ name: "Alice" });
    expect(result.name).toBe("Alice");
    expect(result.limit).toBe(20); // default
  });

  it("accepts custom limit", () => {
    const result = getEntityItemsSchema.parse({ name: "Alice", limit: 50 });
    expect(result.limit).toBe(50);
  });

  it("rejects missing name", () => {
    expect(() => getEntityItemsSchema.parse({})).toThrow(ZodError);
  });

  it("rejects limit out of range", () => {
    expect(() => getEntityItemsSchema.parse({ name: "Alice", limit: 0 })).toThrow(ZodError);
    expect(() => getEntityItemsSchema.parse({ name: "Alice", limit: 200 })).toThrow(
      ZodError,
    );
  });
});

// ---------------------------------------------------------------------------
// get-item-by-id
// ---------------------------------------------------------------------------
describe("getItemByIdSchema", () => {
  it("accepts valid input", () => {
    const result = getItemByIdSchema.parse({ item_id: "00000000-0000-4000-8000-000000000002" });
    expect(result.item_id).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("rejects missing item_id", () => {
    expect(() => getItemByIdSchema.parse({})).toThrow(ZodError);
  });

  it("rejects wrong type", () => {
    expect(() => getItemByIdSchema.parse({ item_id: 42 })).toThrow(ZodError);
  });

  it("rejects non-UUID string", () => {
    expect(() => getItemByIdSchema.parse({ item_id: "short-id" })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// get-pending-items
// ---------------------------------------------------------------------------
describe("getPendingItemsSchema", () => {
  it("accepts empty input (defaults to all)", () => {
    const result = getPendingItemsSchema.parse({});
    expect(result.table).toBe("all");
  });

  it("accepts valid table values", () => {
    expect(getPendingItemsSchema.parse({ table: "items" }).table).toBe("items");
    expect(getPendingItemsSchema.parse({ table: "entities" }).table).toBe("entities");
    expect(getPendingItemsSchema.parse({ table: "item_types" }).table).toBe("item_types");
    expect(getPendingItemsSchema.parse({ table: "all" }).table).toBe("all");
  });

  it("rejects invalid table enum", () => {
    expect(() => getPendingItemsSchema.parse({ table: "users" })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// get-list-items
// ---------------------------------------------------------------------------
describe("getListItemsSchema", () => {
  it("accepts valid input", () => {
    const result = getListItemsSchema.parse({ list_name: "groceries" });
    expect(result.list_name).toBe("groceries");
  });

  it("rejects missing list_name", () => {
    expect(() => getListItemsSchema.parse({})).toThrow(ZodError);
  });

  it("rejects wrong type", () => {
    expect(() => getListItemsSchema.parse({ list_name: 123 })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// get-settings
// ---------------------------------------------------------------------------
describe("getSettingsSchema", () => {
  it("accepts empty input", () => {
    const result = getSettingsSchema.parse({});
    expect(result).toBeDefined();
  });

  it("rejects non-object input", () => {
    expect(() => getSettingsSchema.parse("string")).toThrow(ZodError);
    expect(() => getSettingsSchema.parse(null)).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// get-timeline
// ---------------------------------------------------------------------------
describe("getTimelineSchema", () => {
  it("accepts valid input", () => {
    const result = getTimelineSchema.parse({ start: "2026-01-01", end: "2026-01-31" });
    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2026-01-31");
  });

  it("accepts optional fields", () => {
    const result = getTimelineSchema.parse({
      start: "2026-01-01",
      end: "2026-01-31",
      types: ["note", "task"],
      limit: 50,
    });
    expect(result.types).toEqual(["note", "task"]);
  });

  it("rejects missing required fields", () => {
    expect(() => getTimelineSchema.parse({})).toThrow(ZodError);
    expect(() => getTimelineSchema.parse({ start: "2026-01-01" })).toThrow(ZodError);
  });

  it("rejects invalid date format", () => {
    expect(() =>
      getTimelineSchema.parse({ start: "01-01-2026", end: "2026-01-31" }),
    ).toThrow(ZodError);
    expect(() =>
      getTimelineSchema.parse({ start: "2026-01-01", end: "Jan 31" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// link-item-entity
// ---------------------------------------------------------------------------
describe("linkItemEntitySchema", () => {
  it("accepts valid input", () => {
    const result = linkItemEntitySchema.parse({
      item_id: "00000000-0000-4000-8000-000000000001",
      entity_id: "00000000-0000-4000-8000-000000000010",
    });
    expect(result.item_id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("accepts optional relationship", () => {
    const result = linkItemEntitySchema.parse({
      item_id: "00000000-0000-4000-8000-000000000001",
      entity_id: "00000000-0000-4000-8000-000000000010",
      relationship: "about",
    });
    expect(result.relationship).toBe("about");
  });

  it("rejects missing required fields", () => {
    expect(() => linkItemEntitySchema.parse({})).toThrow(ZodError);
    expect(() => linkItemEntitySchema.parse({ item_id: "00000000-0000-4000-8000-000000000001" })).toThrow(ZodError);
  });

  it("rejects invalid relationship enum", () => {
    expect(() =>
      linkItemEntitySchema.parse({
        item_id: "00000000-0000-4000-8000-000000000001",
        entity_id: "00000000-0000-4000-8000-000000000010",
        relationship: "friend_of",
      }),
    ).toThrow(ZodError);
  });

  it("rejects non-UUID item_id and entity_id", () => {
    expect(() =>
      linkItemEntitySchema.parse({ item_id: "short", entity_id: "00000000-0000-4000-8000-000000000010" }),
    ).toThrow(ZodError);
    expect(() =>
      linkItemEntitySchema.parse({ item_id: "00000000-0000-4000-8000-000000000001", entity_id: "short" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// list-mcp-connections
// ---------------------------------------------------------------------------
describe("listMcpConnectionsSchema", () => {
  it("accepts empty input", () => {
    const result = listMcpConnectionsSchema.parse({});
    expect(result).toBeDefined();
  });

  it("rejects non-object input", () => {
    expect(() => listMcpConnectionsSchema.parse("string")).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// reject-pending
// ---------------------------------------------------------------------------
describe("rejectPendingSchema", () => {
  it("accepts valid input with defaults", () => {
    const result = rejectPendingSchema.parse({ id: "abc-123" });
    expect(result.id).toBe("abc-123");
  });

  it("accepts optional table", () => {
    const result = rejectPendingSchema.parse({ id: "abc-123", table: "entities" });
    expect(result.table).toBe("entities");
  });

  it("rejects missing id", () => {
    expect(() => rejectPendingSchema.parse({})).toThrow(ZodError);
  });

  it("rejects invalid table enum", () => {
    expect(() =>
      rejectPendingSchema.parse({ id: "abc", table: "users" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// remove-mcp-connection
// ---------------------------------------------------------------------------
describe("removeMcpConnectionSchema", () => {
  it("accepts valid input", () => {
    const result = removeMcpConnectionSchema.parse({ id: "conn-1" });
    expect(result.id).toBe("conn-1");
  });

  it("rejects missing id", () => {
    expect(() => removeMcpConnectionSchema.parse({})).toThrow(ZodError);
  });

  it("rejects wrong type", () => {
    expect(() => removeMcpConnectionSchema.parse({ id: 123 })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// search-items
// ---------------------------------------------------------------------------
describe("searchItemsSchema", () => {
  it("accepts valid input", () => {
    const result = searchItemsSchema.parse({ query: "find my notes" });
    expect(result.query).toBe("find my notes");
    expect(result.limit).toBe(20); // default
  });

  it("accepts optional fields", () => {
    const result = searchItemsSchema.parse({
      query: "find my notes",
      type: "note",
      after: "2026-01-01",
      limit: 10,
      agent_knowledge_only: true,
    });
    expect(result.type).toBe("note");
    expect(result.agent_knowledge_only).toBe(true);
  });

  it("rejects missing query", () => {
    expect(() => searchItemsSchema.parse({})).toThrow(ZodError);
  });

  it("rejects invalid after date format", () => {
    expect(() =>
      searchItemsSchema.parse({ query: "test", after: "January 1" }),
    ).toThrow(ZodError);
  });

  it("rejects limit out of range", () => {
    expect(() => searchItemsSchema.parse({ query: "test", limit: 0 })).toThrow(ZodError);
    expect(() => searchItemsSchema.parse({ query: "test", limit: 200 })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// update-item
// ---------------------------------------------------------------------------
describe("updateItemSchema", () => {
  it("accepts valid input", () => {
    const result = updateItemSchema.parse({ item_id: "00000000-0000-4000-8000-000000000001", status: "done" });
    expect(result.item_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(result.status).toBe("done");
  });

  it("accepts content and metadata updates", () => {
    const result = updateItemSchema.parse({
      item_id: "00000000-0000-4000-8000-000000000001",
      content: "updated text",
      metadata: { key: "value" },
    });
    expect(result.content).toBe("updated text");
  });

  it("rejects missing item_id", () => {
    expect(() => updateItemSchema.parse({ status: "done" })).toThrow(ZodError);
  });

  it("rejects invalid status enum", () => {
    expect(() =>
      updateItemSchema.parse({ item_id: "00000000-0000-4000-8000-000000000001", status: "deleted" }),
    ).toThrow(ZodError);
  });

  it("rejects non-UUID item_id", () => {
    expect(() =>
      updateItemSchema.parse({ item_id: "not-a-uuid", status: "done" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// update-mcp-connection
// ---------------------------------------------------------------------------
describe("updateMcpConnectionSchema", () => {
  it("accepts valid input", () => {
    const result = updateMcpConnectionSchema.parse({ id: "conn-1", enabled: false });
    expect(result.id).toBe("conn-1");
    expect(result.enabled).toBe(false);
  });

  it("accepts name update", () => {
    const result = updateMcpConnectionSchema.parse({ id: "conn-1", name: "New Name" });
    expect(result.name).toBe("New Name");
  });

  it("rejects missing id", () => {
    expect(() => updateMcpConnectionSchema.parse({ enabled: true })).toThrow(ZodError);
  });

  it("rejects wrong type for enabled", () => {
    expect(() =>
      updateMcpConnectionSchema.parse({ id: "conn-1", enabled: "yes" }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// update-settings
// ---------------------------------------------------------------------------
describe("updateSettingsSchema", () => {
  it("accepts valid input", () => {
    const result = updateSettingsSchema.parse({
      updates: { user_display_name: "Alice" },
    });
    expect(result.updates.user_display_name).toBe("Alice");
  });

  it("accepts multiple settings", () => {
    const result = updateSettingsSchema.parse({
      updates: {
        user_timezone: "America/Chicago",
        web_search_enabled: true,
        approval_new_type: "auto",
      },
    });
    expect(result.updates.user_timezone).toBe("America/Chicago");
    expect(result.updates.web_search_enabled).toBe(true);
  });

  it("rejects missing updates", () => {
    expect(() => updateSettingsSchema.parse({})).toThrow(ZodError);
  });

  it("rejects invalid approval enum value", () => {
    expect(() =>
      updateSettingsSchema.parse({ updates: { approval_new_type: "maybe" } }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// upsert-entity
// ---------------------------------------------------------------------------
describe("upsertEntitySchema", () => {
  it("accepts valid input", () => {
    const result = upsertEntitySchema.parse({ name: "Alice", type: "person" });
    expect(result.name).toBe("Alice");
    expect(result.type).toBe("person");
  });

  it("accepts optional fields", () => {
    const result = upsertEntitySchema.parse({
      name: "Acme Corp",
      type: "company",
      aliases: ["Acme", "ACME Inc"],
      description: "A fictional company",
    });
    expect(result.aliases).toEqual(["Acme", "ACME Inc"]);
  });

  it("rejects missing required fields", () => {
    expect(() => upsertEntitySchema.parse({})).toThrow(ZodError);
    expect(() => upsertEntitySchema.parse({ name: "Alice" })).toThrow(ZodError);
  });

  it("rejects invalid entity type enum", () => {
    expect(() =>
      upsertEntitySchema.parse({ name: "Alice", type: "animal" }),
    ).toThrow(ZodError);
  });
});
