/**
 * Tool: update_settings — Update Edda configuration settings.
 *
 * Only allows agent-safe keys. Infrastructure and security settings
 * must be changed via CLI or direct DB access.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { updateSettings } from "@edda/db";

/** Settings the agent is allowed to modify */
const AGENT_MUTABLE_KEYS = new Set([
  "user_display_name",
  "user_timezone",
  "web_search_enabled",
  "web_search_max_results",
  "memory_extraction_enabled",
  "user_crons_enabled",
  "approval_new_type",
  "approval_archive_stale",
  "approval_merge_entity",
  "agents_md_token_budget",
  "agents_md_max_per_category",
  "agents_md_max_versions",
  "agents_md_max_entities",
  "system_prompt_override",
]);

export const updateSettingsSchema = z.object({
  updates: z.record(z.unknown()).describe("Key-value pairs to update in settings"),
});

export const updateSettingsTool = tool(
  async ({ updates }) => {
    const safeUpdates: Record<string, unknown> = {};
    const rejected: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (AGENT_MUTABLE_KEYS.has(key)) {
        safeUpdates[key] = value;
      } else {
        rejected.push(key);
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return JSON.stringify({
        status: "no_changes",
        rejected_keys: rejected,
        message: "None of the provided keys are agent-mutable.",
      });
    }

    await updateSettings(safeUpdates);
    return JSON.stringify({
      status: "updated",
      updated_keys: Object.keys(safeUpdates),
      ...(rejected.length > 0 ? { rejected_keys: rejected } : {}),
    });
  },
  {
    name: "update_settings",
    description:
      "Update one or more Edda configuration settings. Only agent-safe settings can be modified.",
    schema: updateSettingsSchema,
  },
);
