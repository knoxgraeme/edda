/**
 * Tool: create_item_type — Create a new dynamic item type.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createItemType, confirmPending, getSettingsSync } from "@edda/db";

export const createItemTypeSchema = z.object({
  name: z.string().describe("Unique type name (snake_case)"),
  description: z.string().describe("What this type represents"),
  classification_hint: z
    .string()
    .describe(
      "When to use this type and what metadata to extract. Follow the pattern: behavioral trigger + signal phrases + boundary with similar types.",
    ),
  metadata_schema: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    },
    z.record(z.unknown()).optional(),
  ).describe("JSON schema for metadata fields"),
  icon: z.string().optional().describe("Emoji icon for the type"),
});

export const createItemTypeTool = tool(
  async ({ name, description, classification_hint, metadata_schema, icon }) => {
    const settings = getSettingsSync();
    const autoConfirm = settings.approval_new_type === "auto";

    const itemType = await createItemType({
      name,
      description,
      classification_hint,
      metadata_schema,
      icon: icon ?? "📦",
    });

    if (autoConfirm) {
      await confirmPending("item_types", name);
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
