/**
 * Tool: get_entity_profile — dynamically assemble a complete entity profile.
 *
 * Replaces read_file /memories/<type>/<slug>. Always fresh, no cron needed.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { resolveEntity, getEntityItems, getEntityConnections } from "@edda/db";

export const getEntityProfileSchema = z.object({
  name: z.string().describe("Entity name or alias to look up"),
  max_items: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of linked items to include"),
  include_connections: z
    .boolean()
    .default(true)
    .describe("Include connected entities via shared items"),
});

export const getEntityProfileTool = tool(
  async ({ name, max_items, include_connections }) => {
    const entity = await resolveEntity(name);
    if (!entity) return JSON.stringify({ found: false, query: name });

    const items = await getEntityItems(entity.id, { limit: max_items });
    const connections = include_connections ? await getEntityConnections(entity.id) : [];

    // Group items by type for readability
    const itemsByType: Record<string, Array<{ content: string; day: string | null }>> = {};
    for (const item of items) {
      const key = item.type;
      if (!itemsByType[key]) itemsByType[key] = [];
      itemsByType[key].push({ content: item.content, day: item.day });
    }

    return JSON.stringify({
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        aliases: entity.aliases,
        mention_count: entity.mention_count,
        last_seen_at: entity.last_seen_at,
      },
      items_by_type: itemsByType,
      connections: connections.map((c) => ({
        name: c.name,
        type: c.type,
        shared_items: c.shared_items,
        relationship: c.top_relationship,
      })),
      total_items: items.length,
    });
  },
  {
    name: "get_entity_profile",
    description:
      "Get a complete profile for an entity — their details, linked items grouped by type, and connections to other entities via shared items.",
    schema: getEntityProfileSchema,
  },
);
