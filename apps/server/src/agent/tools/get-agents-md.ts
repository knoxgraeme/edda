/**
 * Tool: get_agents_md — Read the current AGENTS.md procedural memory content.
 *
 * Returns the latest AGENTS.md content for the calling agent, along with
 * the token budget for the document.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getLatestAgentsMd, getSettingsSync } from "@edda/db";
import { getAgentName } from "../tool-helpers.js";

export const getAgentsMdSchema = z.object({});

export const getAgentsMdTool = tool(
  async (_input, config) => {
    const agentName = getAgentName(config);
    if (!agentName) throw new Error("agent_name required in configurable");

    const settings = getSettingsSync();
    const latest = await getLatestAgentsMd(agentName);

    return JSON.stringify({
      content: latest?.content ?? "(empty — no operating notes yet)",
      token_budget: settings.agents_md_token_budget,
    });
  },
  {
    name: "get_agents_md",
    description:
      "Read your current AGENTS.md procedural memory (communication preferences, behavioral patterns, quality standards, corrections). Returns the full content and token budget.",
    schema: getAgentsMdSchema,
  },
);
