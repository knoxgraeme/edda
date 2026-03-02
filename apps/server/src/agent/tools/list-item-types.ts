/**
 * Tool: list_item_types — List all available item types with classification hints.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getItemTypes } from "@edda/db";

export const listItemTypesSchema = z.object({});

export const listItemTypesTool = tool(
  async () => {
    const types = await getItemTypes();
    const visible = types.filter((t) => !t.agent_internal);
    return JSON.stringify({
      count: visible.length,
      types: visible.map((t) => ({
        name: t.name,
        icon: t.icon,
        description: t.description,
        classification_hint: t.classification_hint,
      })),
    });
  },
  {
    name: "list_item_types",
    description:
      "List all available item types with their icons, descriptions, and classification hints. " +
      "Use this to see what types exist before creating items.",
    schema: listItemTypesSchema,
  },
);
