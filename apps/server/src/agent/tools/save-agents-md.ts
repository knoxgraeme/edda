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
import { buildDeterministicTemplate } from "../generate-agents-md.js";
import { getAgentName } from "../tool-helpers.js";
import { rebuildDefaultAgent } from "../../server/index.js";

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
      console.error("[save_agents_md] Pruning old versions failed (save succeeded):", err);
    }

    // Rebuild the live agent so the next conversation picks up the new memory
    rebuildDefaultAgent().catch((err) =>
      console.warn("[save_agents_md] Background rebuild failed:", err),
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
