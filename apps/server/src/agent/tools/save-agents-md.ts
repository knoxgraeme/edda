/**
 * Tool: save_agents_md — Write a new AGENTS.md version to the database.
 *
 * Scoped write tool for the context_refresh subagent.
 * Not included in the main agent's tool set.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const saveAgentsMdSchema = z.object({
  content: z.string().min(1).max(8000).describe("The full curated AGENTS.md content"),
});

/**
 * Schema-only tool bound to the context_refresh subagent via model.bindTools().
 * The tool handler just returns the content — the real DB write happens in
 * runContextRefreshAgent() which extracts the tool call args and saves with
 * the correct template and input_hash.
 */
export const saveAgentsMdTool = tool(
  async ({ content }) => {
    return JSON.stringify({ content, length: content.length });
  },
  {
    name: "save_agents_md",
    description:
      "Save a new version of the AGENTS.md user context document. Only used by the context_refresh subagent.",
    schema: saveAgentsMdSchema,
  },
);
