/**
 * Tool: list_skills — List all available skills.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getSkills } from "@edda/db";

export const listSkillsSchema = z.object({
  include_system: z
    .boolean()
    .default(true)
    .describe("Include built-in system skills (default: true)"),
});

export const listSkillsTool = tool(
  async ({ include_system }) => {
    const skills = await getSkills();
    const filtered = include_system ? skills : skills.filter((s) => !s.is_system);

    return JSON.stringify(
      filtered.map((s) => ({
        name: s.name,
        description: s.description,
        is_system: s.is_system,
        version: s.version,
      })),
    );
  },
  {
    name: "list_skills",
    description:
      "List all available skills with their descriptions. Use to discover skills when creating or configuring agents.",
    schema: listSkillsSchema,
  },
);
