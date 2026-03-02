/**
 * Tool: seed_agents_md — Seed AGENTS.md for a newly created agent.
 *
 * Unlike save_agents_md (which is self-scoped), this tool writes to a
 * different agent's AGENTS.md. Safety: only allows seeding if the target
 * agent's AGENTS.md is still in the initial empty-seed state.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentByName, getLatestAgentsMd, saveAgentsMdVersion } from "@edda/db";
import { invalidateAgent } from "../agent-cache.js";
import { isEmptyAgentsMdSeed } from "./agents-md-seed.js";

export const seedAgentsMdSchema = z.object({
  agent_name: z.string().min(1).describe("Name of the agent to seed AGENTS.md for"),
  content: z
    .string()
    .min(1)
    .max(8000)
    .describe("The AGENTS.md content to seed (communication, patterns, standards, corrections)"),
});

export const seedAgentsMdTool = tool(
  async ({ agent_name, content }) => {
    const agent = await getAgentByName(agent_name);
    if (!agent) throw new Error(`Agent not found: ${agent_name}`);

    const existing = await getLatestAgentsMd(agent_name);
    if (existing && !isEmptyAgentsMdSeed(existing.content)) {
      throw new Error(
        `Agent '${agent_name}' already has curated AGENTS.md content. Use save_agents_md (as that agent) to update it.`,
      );
    }

    await saveAgentsMdVersion({ content, agentName: agent_name });
    invalidateAgent(agent_name);

    return JSON.stringify({ seeded: true, agent_name, length: content.length });
  },
  {
    name: "seed_agents_md",
    description:
      "Seed AGENTS.md procedural memory for a newly created agent. Only works if the agent's AGENTS.md is still in the initial empty state. Use to transfer relevant user context to new agents.",
    schema: seedAgentsMdSchema,
  },
);
