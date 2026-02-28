/**
 * Tool: save_agents_md — Write a new AGENTS.md version to the database.
 *
 * Self-contained: rebuilds the deterministic template and stores the content
 * along with the current template hash so subsequent get_context_diff calls
 * can detect changes.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getSettingsSync,
  saveAgentsMdVersion,
  pruneAgentsMdVersions,
} from "@edda/db";
import { buildDeterministicTemplate } from "../agents-md-template.js";
import { getAgentName } from "../tool-helpers.js";
import { rebuildAgent } from "../../server/index.js";
import { getLogger } from "../../logger.js";

export const saveAgentsMdSchema = z.object({
  content: z.string().min(1).max(8000).describe("The full curated AGENTS.md content"),
});

export const saveAgentsMdTool = tool(
  async ({ content }, config) => {
    const agentName = getAgentName(config);
    if (!agentName) throw new Error("agent_name required in configurable");

    const settings = getSettingsSync();
    const { template, hash } = await buildDeterministicTemplate();
    await saveAgentsMdVersion({ content, template, inputHash: hash, agentName });

    try {
      await pruneAgentsMdVersions(settings.agents_md_max_versions);
    } catch (err) {
      getLogger().error({ err }, "save_agents_md pruning old versions failed (save succeeded)");
    }

    // Rebuild the live agent so the next conversation picks up the new memory
    rebuildAgent(agentName).catch((err) =>
      getLogger().warn({ err }, "save_agents_md background rebuild failed"),
    );

    return JSON.stringify({ saved: true, length: content.length });
  },
  {
    name: "save_agents_md",
    description:
      "Save a new version of your AGENTS.md procedural memory (communication preferences, behavioral patterns, quality standards, corrections). Call when you learn something about how to serve this user better.",
    schema: saveAgentsMdSchema,
  },
);
