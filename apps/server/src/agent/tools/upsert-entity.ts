/**
 * Tool: upsert_entity — Create or update an entity in the knowledge graph.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { upsertEntity } from "@edda/db";
import { embed } from "../../embed/index.js";

export const upsertEntitySchema = z.object({
  name: z.string().describe("Entity name"),
  type: z
    .enum(["person", "project", "company", "topic", "place", "tool", "concept"])
    .describe("Entity type"),
  aliases: z.array(z.string()).optional().describe("Alternative names for the entity"),
  description: z.string().optional().describe("Brief description of the entity"),
});

export const upsertEntityTool = tool(
  async ({ name, type, aliases, description }) => {
    const embedding = await embed(`${type}: ${name}. ${description || ""}`);
    const entity = await upsertEntity({ name, type, aliases, description, embedding });
    return JSON.stringify({ entity_id: entity.id, status: "upserted" });
  },
  {
    name: "upsert_entity",
    description:
      "Create or update an entity (person, project, company, topic, place, tool, or concept) in the knowledge graph.",
    schema: upsertEntitySchema,
  },
);
