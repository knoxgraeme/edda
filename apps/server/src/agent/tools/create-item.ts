/**
 * Tool: create_item — Create a single item in the knowledge base.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createItem, getSettingsSync, searchItems, updateItem, getListByName, getListById, type List } from "@edda/db";
import { embed, buildEmbeddingText } from "../../embed/index.js";
import type { EmbeddingContext } from "../../embed/index.js";
import { getAgentName } from "../tool-helpers.js";

export const createItemSchema = z.object({
  type: z.string().describe("The item type (e.g. note, task, event, preference)"),
  content: z.string().describe("The main content text"),
  summary: z.string().optional().describe("A short summary of the content"),
  metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata for the item"),
  day: z.string().optional().describe("Date for the item (YYYY-MM-DD). Defaults to today."),
  status: z
    .enum(["active", "done", "archived", "snoozed"])
    .optional()
    .describe("Item status (default: active)"),
  parent_id: z.string().optional().describe("Parent item ID (for hierarchical items, not lists)"),
  list_id: z.string().uuid().optional().describe("List UUID to add this item to"),
  list_name: z.string().optional().describe("List name to add this item to (resolved automatically)"),
  source: z
    .enum(["chat", "cli", "api", "cron", "agent", "posthook"])
    .optional()
    .describe("Origin of this item (default: chat)"),
  confirmed: z
    .boolean()
    .optional()
    .describe("Whether confirmed (default: true)"),
  pending_action: z
    .string()
    .optional()
    .describe("Pending action (e.g. 'confirm', 'merge')"),
});

const DEDUP_TYPES = new Set(['preference', 'learned_fact', 'pattern']);

export const createItemTool = tool(
  async ({ type, content, summary, metadata, day, status, parent_id, list_id, list_name, source, confirmed, pending_action }, config) => {
    const agentName = getAgentName(config);
    const finalMetadata = agentName
      ? { ...(metadata ?? {}), created_by: agentName }
      : metadata;
    const settings = getSettingsSync();

    // List resolution
    let resolvedListId = list_id ?? null;
    let resolvedList: List | null = null;
    if (list_name && !resolvedListId) {
      resolvedList = await getListByName(list_name);
      if (!resolvedList) {
        return JSON.stringify({
          error: `No list found with name "${list_name}". Create it first with create_list.`,
        });
      }
      resolvedListId = resolvedList.id;
    }

    // Embedding context from list — reuse resolvedList if available
    let embeddingContext: EmbeddingContext | null = null;
    if (resolvedListId) {
      const list = resolvedList ?? await getListById(resolvedListId);
      if (list) {
        embeddingContext = { listName: list.name, listSummary: list.summary ?? undefined };
      }
    }

    const embedding = await embed(buildEmbeddingText(type, content, summary, embeddingContext));

    // Dedup check — only for knowledge types (preference, learned_fact, pattern)
    if (DEDUP_TYPES.has(type)) {
      const similar = await searchItems(embedding, {
        threshold: settings.memory_reinforce_threshold,
        limit: 1,
        type,
        confirmedOnly: false,
      });

      if (similar.length > 0 && !['done', 'archived'].includes(similar[0].status)) {
        await updateItem(similar[0].id, {
          last_reinforced_at: new Date().toISOString(),
        });
        return JSON.stringify({
          id: similar[0].id,
          type: similar[0].type,
          status: similar[0].status,
          day: similar[0].day,
          reinforced: true,
        });
      }
    }

    const item = await createItem({
      type,
      content,
      summary,
      metadata: finalMetadata,
      day,
      status,
      parent_id,
      list_id: resolvedListId ?? undefined,
      embedding,
      embedding_model: settings.embedding_model,
      source: source ?? "chat",
      confirmed,
      pending_action,
    });

    return JSON.stringify({
      id: item.id,
      type: item.type,
      status: item.status,
      day: item.day,
    });
  },
  {
    name: "create_item",
    description:
      "Create a new item in the knowledge base. Automatically generates an embedding for semantic search. Knowledge types (preference, learned_fact, pattern) are deduplicated — near-duplicates are reinforced instead of creating new items.",
    schema: createItemSchema,
  },
);
