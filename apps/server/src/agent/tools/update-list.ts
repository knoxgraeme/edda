/**
 * Tool: update_list — Update a list's name, summary, icon, status, or type.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getListByName, getListById, updateList, getSettingsSync, type List } from "@edda/db";
import { embed, buildEmbeddingText } from "../../embed/index.js";

export const updateListSchema = z.object({
  list_name: z
    .string()
    .optional()
    .describe("Current list name (case-insensitive). Provide list_name or list_id."),
  list_id: z
    .string()
    .uuid()
    .optional()
    .describe("List UUID. Provide list_name or list_id."),
  name: z.string().min(1).max(200).optional().describe("New name for the list"),
  summary: z.string().max(2000).optional().describe("New description"),
  icon: z.string().max(10).optional().describe("New emoji icon"),
  status: z
    .enum(["active", "archived"])
    .optional()
    .describe("Set to 'archived' to archive the list"),
  list_type: z.enum(["rolling", "one_off"]).optional(),
});

export const updateListTool = tool(
  async ({ list_name, list_id, name, summary, icon, status, list_type }) => {
    if (!list_name && !list_id) {
      return JSON.stringify({ error: "Provide list_name or list_id" });
    }

    // Resolve list
    let list = list_id ? await getListById(list_id) : null;
    if (!list && list_name) {
      list = await getListByName(list_name);
    }
    if (!list) {
      return JSON.stringify({
        error: `List not found${list_name ? ` with name "${list_name}"` : ""}${list_id ? ` with id "${list_id}"` : ""}`,
      });
    }

    // Build updates
    const updates: Partial<Pick<List, 'name' | 'summary' | 'icon' | 'status' | 'list_type' | 'embedding' | 'embedding_model'>> = {};
    if (name !== undefined) updates.name = name;
    if (summary !== undefined) updates.summary = summary;
    if (icon !== undefined) updates.icon = icon;
    if (status !== undefined) updates.status = status;
    if (list_type !== undefined) updates.list_type = list_type;

    if (Object.keys(updates).length === 0) {
      return JSON.stringify({ error: "No fields to update" });
    }

    // Re-embed if name or summary changes
    if (name !== undefined || summary !== undefined) {
      const settings = getSettingsSync();
      const embeddingName = name ?? list.name;
      const embeddingSummary = summary ?? list.summary;
      updates.embedding = await embed(
        buildEmbeddingText("list", embeddingName, embeddingSummary),
      );
      updates.embedding_model = settings.embedding_model;
    }

    const updated = await updateList(list.id, updates);
    if (!updated) {
      return JSON.stringify({ error: "Failed to update list" });
    }

    return JSON.stringify({
      id: updated.id,
      name: updated.name,
      summary: updated.summary,
      icon: updated.icon,
      list_type: updated.list_type,
      status: updated.status,
    });
  },
  {
    name: "update_list",
    description:
      "Update a list's name, summary, icon, type, or status. Resolve by name (case-insensitive) or UUID. Set status to 'archived' to archive a list.",
    schema: updateListSchema,
  },
);
