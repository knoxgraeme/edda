/**
 * Tool: batch_create_items — Create multiple items in a single transaction.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { batchCreateItems, getSettingsSync, getListByName, type List } from "@edda/db";
import { embedBatch, buildEmbeddingText } from "../../embed.js";
import type { EmbeddingContext } from "../../embed.js";
import { getAgentName } from "../tool-helpers.js";

const batchItemSchema = z.object({
  content: z.string().describe("The item content text"),
  summary: z.string().optional().describe("Short summary of the item"),
  type: z.string().describe("Item type (must exist in item_types)"),
  day: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
  metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata for the item"),
  parent_id: z.string().optional().describe("Parent item ID (for hierarchical items, not lists)"),
  list_id: z.string().uuid().optional().describe("List UUID"),
  list_name: z.string().optional().describe("List name (resolved automatically)"),
  confirmed: z.boolean().optional().describe("Default true. Set false when approval is needed."),
});

export const batchCreateItemsSchema = z.object({
  items: z.array(batchItemSchema).min(1).max(50).describe("Array of items to create"),
});

export const batchCreateItemsTool = tool(
  async ({ items }, config) => {
    const agentName = getAgentName(config);
    const settings = getSettingsSync();
    const today = new Date().toISOString().split("T")[0];

    // Resolve list names to full List objects (cached)
    const listCache = new Map<string, List>(); // name → List
    for (const item of items) {
      if (item.list_name && !item.list_id && !listCache.has(item.list_name)) {
        const list = await getListByName(item.list_name);
        if (list) listCache.set(item.list_name, list);
      }
    }

    // Pre-flight: fail if any list_name could not be resolved
    const unresolvedLists: string[] = [];
    for (const item of items) {
      if (item.list_name && !item.list_id && !listCache.has(item.list_name)) {
        unresolvedLists.push(item.list_name);
      }
    }
    if (unresolvedLists.length > 0) {
      return JSON.stringify({
        error: `Lists not found: ${[...new Set(unresolvedLists)].join(', ')}. Create them first with create_list.`,
      });
    }

    // Build embedding context directly from cached List objects
    const embeddingContextByListId = new Map<string, EmbeddingContext>();
    for (const list of listCache.values()) {
      embeddingContextByListId.set(list.id, {
        listName: list.name,
        listSummary: list.summary ?? undefined,
      });
    }

    const embeddings = await embedBatch(
      items.map((item) => {
        const lid = item.list_id ?? (item.list_name ? listCache.get(item.list_name)?.id : undefined);
        const ctx = lid ? embeddingContextByListId.get(lid) ?? null : null;
        return buildEmbeddingText(item.type, item.content, item.summary, ctx);
      }),
    );

    const inputs = items.map((item, i) => {
      const resolvedListId = item.list_id ?? (item.list_name ? listCache.get(item.list_name)?.id : undefined);
      return {
        content: item.content,
        summary: item.summary,
        type: item.type,
        embedding: embeddings[i],
        embedding_model: settings.embedding_model,
        day: item.day ?? today,
        metadata: agentName
          ? { ...(item.metadata ?? {}), created_by: agentName }
          : (item.metadata ?? {}),
        parent_id: item.parent_id,
        list_id: resolvedListId,
        confirmed: item.confirmed ?? true,
        source: "chat" as const,
      };
    });

    const created = await batchCreateItems(inputs);

    return JSON.stringify({
      count: created.length,
      item_ids: created.map((item) => item.id),
    });
  },
  {
    name: "batch_create_items",
    description:
      "Create multiple items in a single batch. More efficient than calling create_item repeatedly.",
    schema: batchCreateItemsSchema,
  },
);
