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

export const saveAgentsMdSchema = z.object({
  content: z.string().min(1).max(8000).describe("The full curated AGENTS.md content"),
});

export const saveAgentsMdTool = tool(
  async ({ content }) => {
    const settings = getSettingsSync();
    const { template, hash } = await buildDeterministicTemplate();
    await saveAgentsMdVersion({ content, template, inputHash: hash });
    await pruneAgentsMdVersions(settings.agents_md_max_versions);
    return JSON.stringify({ saved: true, length: content.length });
  },
  {
    name: "save_agents_md",
    description:
      "Save a new version of the AGENTS.md user context document. Call after editing the content returned by get_context_diff.",
    schema: saveAgentsMdSchema,
  },
);
