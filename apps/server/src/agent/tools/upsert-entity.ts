/**
 * Tool: upsert_entity — Create or update an entity in the knowledge graph.
 *
 * When approval_new_entity = 'confirm' in settings, new entities are created
 * with confirmed: false and an inbox notification is sent for review.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { upsertEntity, getSettingsSync, createNotification } from "@edda/db";
import { embed } from "../../embed.js";
import { getLogger } from "../../logger.js";

export const upsertEntitySchema = z.object({
  name: z.string().describe("Entity name"),
  type: z
    .enum(["person", "project", "company", "topic", "place", "tool", "concept"])
    .describe("Entity type"),
  aliases: z.array(z.string()).optional().describe("Alternative names for the entity"),
  description: z.string().optional().describe("Brief description of the entity"),
  confirmed: z
    .boolean()
    .optional()
    .describe("Whether this entity is confirmed (default: true). Set false for uncertain entity merges."),
  pending_action: z
    .string()
    .nullable()
    .optional()
    .describe("Pending review action (e.g. 'confirm', 'merge'), or null to clear"),
});

export const upsertEntityTool = tool(
  async ({ name, type, aliases, description, confirmed, pending_action }) => {
    const settings = getSettingsSync();
    const isApprovalMode = settings.approval_new_entity === "confirm";

    const embedding = await embed(`${type}: ${name}. ${description || ""}`);
    const entity = await upsertEntity({
      name,
      type,
      aliases,
      description,
      embedding,
      confirmed: confirmed ?? (isApprovalMode ? undefined : true),
      pending_action,
    });

    // If approval mode is 'confirm' and this is a new entity (mention_count = 1),
    // set confirmed=false and create an inbox notification for review
    if (isApprovalMode && entity.mention_count === 1) {
      if (entity.confirmed !== false) {
        await upsertEntity({
          name,
          type,
          embedding,
          confirmed: false,
        });
      }
      try {
        await createNotification({
          source_type: "system",
          source_id: `entity:${entity.id}`,
          target_type: "inbox",
          summary: `New entity pending review: ${name} (${type})`,
          detail: { entity_id: entity.id, entity_name: name, entity_type: type },
          priority: "normal",
        });
      } catch (err) {
        getLogger().error({ err, entityId: entity.id, entityName: name }, "Failed to create entity approval notification");
      }
    }

    return JSON.stringify({ entity_id: entity.id, status: "upserted" });
  },
  {
    name: "upsert_entity",
    description:
      "Create or update an entity (person, project, company, topic, place, tool, or concept) in the knowledge graph.",
    schema: upsertEntitySchema,
  },
);
