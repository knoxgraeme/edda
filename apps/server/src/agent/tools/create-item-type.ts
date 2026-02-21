/**
 * Tool: create_item_type — Create a new dynamic item type.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createItemType, getSettingsSync, confirmItemType } from "@edda/db";

export const createItemTypeSchema = z.object({
  name: z.string().describe("Unique type name (snake_case)"),
  description: z.string().describe("What this type represents"),
  extraction_hint: z.string().describe("Hint for the classifier to identify this type"),
  metadata_schema: z.record(z.unknown()).optional().describe("JSON schema for metadata fields"),
  icon: z.string().optional().describe("Emoji icon for the type"),
  dashboard_section: z
    .string()
    .optional()
    .describe("Dashboard section to display this type in (e.g. 'actionable', 'captured', 'lists')"),
  completable: z.boolean().optional().describe("Whether items of this type can be marked done"),
  has_due_date: z.boolean().optional().describe("Whether items of this type have a due date"),
  is_list: z.boolean().optional().describe("Whether this type represents a list"),
});

export const createItemTypeTool = tool(
  async ({ name, description, extraction_hint, metadata_schema, icon, dashboard_section, completable, has_due_date, is_list }) => {
    const settings = getSettingsSync();
    const autoConfirm = settings.approval_new_type === "auto";

    const itemType = await createItemType({
      name,
      description,
      classification_hint: extraction_hint,
      metadata_schema,
      icon: icon ?? "📦",
      dashboard_section,
      completable,
      has_due_date,
      is_list,
    });

    if (autoConfirm) {
      await confirmItemType(name);
    }

    return JSON.stringify({
      name: itemType.name,
      status: autoConfirm ? "confirmed" : "pending_confirmation",
      description: itemType.description,
    });
  },
  {
    name: "create_item_type",
    description:
      "Create a new item type for the knowledge base. Respects approval_new_type setting.",
    schema: createItemTypeSchema,
  },
);
