/**
 * Tool: create_list — Create a new named list for organizing items.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createList, getListByName, getSettingsSync } from "@edda/db";
import { embed, buildEmbeddingText } from "../../embed/index.js";

export const createListSchema = z.object({
  name: z.string().describe("The list name (e.g. 'Grocery List', 'Movies to Watch')"),
  summary: z.string().optional().describe("Description of what the list is for — improves recall"),
  list_type: z
    .enum(["rolling", "one_off"])
    .default("rolling")
    .describe(
      "'rolling' for recurring lists (grocery, movies), 'one_off' for temporary (trip packing)",
    ),
  icon: z.string().optional().describe("Emoji icon for the list (default: 📋)"),
});

export const createListTool = tool(
  async ({ name, summary, list_type, icon }) => {
    const normalizedName = name.trim().toLowerCase();

    // Check for duplicate
    const existing = await getListByName(normalizedName);
    if (existing) {
      return JSON.stringify({
        error: `A list named '${existing.name}' already exists`,
        existing_list: {
          id: existing.id,
          name: existing.name,
          summary: existing.summary,
          list_type: existing.list_type,
          icon: existing.icon,
          status: existing.status,
        },
      });
    }

    const settings = getSettingsSync();
    const embedding = await embed(
      buildEmbeddingText("list", name, summary),
    );

    const list = await createList({
      name,
      normalized_name: normalizedName,
      summary,
      icon,
      list_type,
      embedding,
      embedding_model: settings.embedding_model,
    });

    return JSON.stringify({
      id: list.id,
      name: list.name,
      summary: list.summary,
      list_type: list.list_type,
      icon: list.icon,
    });
  },
  {
    name: "create_list",
    description:
      "Create a new named list for organizing items. Lists group items by topic (e.g. 'Grocery List', 'Movies to Watch'). Returns an error with existing list info if a list with the same name already exists.",
    schema: createListSchema,
  },
);
