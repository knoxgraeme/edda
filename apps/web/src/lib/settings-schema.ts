/**
 * Shared schema for settings PATCH/update payloads.
 *
 * Single source of truth consumed by both the server action
 * (`apps/web/src/app/actions.ts`) and the REST route
 * (`apps/web/src/app/api/v1/settings/route.ts`).
 *
 * Must remain client-safe: do NOT import from `@edda/db` or `@edda/server`.
 * LLM provider values come from `VALID_LLM_PROVIDERS` in `./providers`.
 * Dynamic validation (e.g. agent-existence for `default_agent`) belongs in
 * route-level handlers, not here.
 */

import { z } from "zod";
import { VALID_LLM_PROVIDERS } from "./providers";

export const isValidIanaTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const LLM_PROVIDER_VALUES = Array.from(VALID_LLM_PROVIDERS) as [string, ...string[]];

export const UpdateSettingsSchema = z
  .object({
    user_display_name: z.string().max(200).nullable().optional(),
    user_timezone: z
      .string()
      .max(100)
      .optional()
      .refine((value) => value === undefined || isValidIanaTimezone(value), "Invalid IANA timezone"),
    llm_provider: z.enum(LLM_PROVIDER_VALUES).optional(),
    default_model: z.string().max(100).optional(),
    embedding_provider: z.enum(["voyage", "openai", "google"]).optional(),
    embedding_model: z.string().max(100).optional(),
    embedding_dimensions: z.number().int().positive().max(4096).optional(),
    search_provider: z.enum(["brave", "tavily", "duckduckgo", "serper", "serpapi"]).optional(),
    web_search_max_results: z.number().int().min(1).max(50).optional(),
    default_agent: z.string().min(1).max(200).optional(),
    task_max_concurrency: z.number().int().min(1).max(10).optional(),
    cron_runner: z.enum(["local", "langgraph"]).optional(),
    sandbox_provider: z.enum(["none", "node-vfs"]).optional(),
    approval_new_type: z.enum(["auto", "confirm"]).optional(),
    approval_new_entity: z.enum(["auto", "confirm"]).optional(),
    approval_archive_stale: z.enum(["auto", "confirm"]).optional(),
    approval_merge_entity: z.enum(["auto", "confirm"]).optional(),
    agents_md_token_budget: z.number().int().positive().max(32000).optional(),
    agents_md_max_per_category: z.number().int().positive().max(500).optional(),
    agents_md_max_versions: z.number().int().positive().max(500).optional(),
    agents_md_max_entities: z.number().int().positive().max(1000).optional(),
    system_prompt_override: z.string().max(10000).nullable().optional(),
  })
  .strip();

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
