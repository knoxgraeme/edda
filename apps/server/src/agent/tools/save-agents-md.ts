/**
 * Tool: save_agents_md — Write a new AGENTS.md version to the database.
 *
 * Saves the agent's curated procedural memory content, prunes old versions,
 * and invalidates the agent cache so the next conversation picks up changes.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getSettingsSync,
  saveAgentsMdVersion,
  pruneAgentsMdVersions,
} from "@edda/db";
import { getAgentName } from "../tool-helpers.js";
import { invalidateAgent } from "../agent-cache.js";
import { getLogger } from "../../logger.js";

export const saveAgentsMdSchema = z.object({
  content: z.string().min(1).max(8000).describe("The full curated AGENTS.md content"),
});

export const saveAgentsMdTool = tool(
  async ({ content }, config) => {
    const agentName = getAgentName(config);
    if (!agentName) throw new Error("agent_name required in configurable");

    const settings = getSettingsSync();
    await saveAgentsMdVersion({ content, agentName });

    try {
      await pruneAgentsMdVersions(settings.agents_md_max_versions);
    } catch (err) {
      getLogger().error({ err }, "save_agents_md pruning old versions failed (save succeeded)");
    }

    invalidateAgent(agentName);

    return JSON.stringify({ saved: true, length: content.length });
  },
  {
    name: "save_agents_md",
    description:
      "Save a new version of your AGENTS.md procedural memory (communication preferences, behavioral patterns, quality standards, corrections). Call when you learn something about how to serve this user better.",
    schema: saveAgentsMdSchema,
  },
);
