/**
 * Tool: get_settings — Return current Edda settings.
 *
 * Redacts infrastructure fields not relevant to the agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getSettingsSync } from "@edda/db";
import type { Settings } from "@edda/db";

/** Fields the agent legitimately needs to read. Explicit allowlist — secure by default. */
const AGENT_VISIBLE_KEYS: (keyof Settings)[] = [
  "default_agent",
  "llm_provider",
  "default_model",
  "task_max_concurrency",
  "notification_targets",
  "user_display_name",
  "user_timezone",
  "web_search_enabled",
  "web_search_max_results",
  "approval_new_type",
  "approval_archive_stale",
  "approval_merge_entity",
  "agents_md_token_budget",
  "agents_md_max_per_category",
  "agents_md_max_versions",
  "agents_md_max_entities",
];

export const getSettingsSchema = z.object({});

export const getSettingsTool = tool(
  async () => {
    const settings = getSettingsSync();
    const filtered = Object.fromEntries(
      AGENT_VISIBLE_KEYS.map((k) => [k, settings[k]]),
    );
    return JSON.stringify(filtered);
  },
  {
    name: "get_settings",
    description: "Return the current Edda configuration settings.",
    schema: getSettingsSchema,
  },
);
