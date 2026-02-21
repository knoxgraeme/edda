/**
 * Tool: get_settings — Return current Edda settings.
 *
 * Redacts infrastructure fields not relevant to the agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getSettingsSync } from "@edda/db";
import type { Settings } from "@edda/db";

const REDACTED_KEYS: (keyof Settings)[] = [
  "id",
  "checkpointer_backend",
  "cron_runner",
  "langgraph_platform_url",
  "created_at",
  "updated_at",
];

export const getSettingsSchema = z.object({});

export const getSettingsTool = tool(
  async () => {
    const settings = getSettingsSync();
    const filtered = Object.fromEntries(
      Object.entries(settings).filter(([k]) => !REDACTED_KEYS.includes(k as keyof Settings)),
    );
    return JSON.stringify(filtered);
  },
  {
    name: "get_settings",
    description: "Return the current Edda configuration settings.",
    schema: getSettingsSchema,
  },
);
