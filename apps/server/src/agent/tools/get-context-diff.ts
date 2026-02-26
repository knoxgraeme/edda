/**
 * Tool: get_context_diff — Check if user context data has changed since
 * the last AGENTS.md edit.
 *
 * Builds the deterministic template fresh from DB queries, diffs against
 * the latest stored version, and returns the diff or "no_changes".
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getLatestAgentsMd, getSettingsSync } from "@edda/db";
import {
  buildDeterministicTemplate,
  buildTemplateDiff,
} from "../generate-agents-md.js";

export const getContextDiffSchema = z.object({});

export const getContextDiffTool = tool(
  async () => {
    const settings = getSettingsSync();
    const { template, hash } = await buildDeterministicTemplate();
    const latest = await getLatestAgentsMd();

    if (latest?.input_hash === hash) {
      return JSON.stringify({ status: "no_changes" });
    }

    const diff = buildTemplateDiff(latest?.template ?? "", template);
    if (diff === "(no changes)") {
      return JSON.stringify({ status: "no_changes" });
    }

    return JSON.stringify({
      status: "changes_detected",
      current_content: latest?.content ?? "(empty — first version)",
      diff,
      raw_template: template,
      token_budget: settings.agents_md_token_budget,
    });
  },
  {
    name: "get_context_diff",
    description:
      "Check if user context data has changed since the last AGENTS.md edit. Returns the diff and current content if changes exist, or 'no_changes' if up to date. Call this before editing AGENTS.md.",
    schema: getContextDiffSchema,
  },
);
