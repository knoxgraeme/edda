/**
 * Tool: update_settings — Update Edda configuration settings.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { updateSettings } from "@edda/db";

export const updateSettingsSchema = z.object({
  updates: z.record(z.any()).describe("Key-value pairs to update in settings"),
});

export const updateSettingsTool = tool(
  async ({ updates }) => {
    const settings = await updateSettings(updates);
    return JSON.stringify(settings);
  },
  {
    name: "update_settings",
    description: "Update one or more Edda configuration settings.",
    schema: updateSettingsSchema,
  },
);
