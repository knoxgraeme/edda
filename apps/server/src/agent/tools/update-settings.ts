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
  "daily_digest_time",
  "web_search_enabled",
  "web_search_max_results",
  "memory_extraction_enabled",
  "user_crons_enabled",
  "type_evolution_enabled",
  "approval_new_type",
  "approval_archive_stale",
  "approval_merge_entity",
  "agents_md_token_budget",
  "agents_md_max_versions",
]);

export const updateSettingsSchema = z.object({
  updates: z
    .object({
      user_display_name: z.string().optional(),
      user_timezone: z.string().optional(),
      daily_digest_time: z
        .string()
        .regex(/^\d{2}:\d{2}$/, "HH:MM format")
        .optional(),
      web_search_enabled: z.boolean().optional(),
      web_search_max_results: z.number().int().min(1).max(20).optional(),
      memory_extraction_enabled: z.boolean().optional(),
      user_crons_enabled: z.boolean().optional(),
      type_evolution_enabled: z.boolean().optional(),
      approval_new_type: z.enum(["auto", "confirm"]).optional(),
      approval_archive_stale: z.enum(["auto", "confirm"]).optional(),
      approval_merge_entity: z.enum(["auto", "confirm"]).optional(),
      agents_md_token_budget: z.number().int().min(100).max(10000).optional(),
      agents_md_max_versions: z.number().int().min(1).max(50).optional(),
    })
    .describe("Settings key-value pairs to update. Only user-facing settings are modifiable."),
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
