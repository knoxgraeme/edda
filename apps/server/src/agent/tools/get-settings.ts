/**
 * Tool: get_settings — Return current Edda settings.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getSettingsSync } from "@edda/db";

export const getSettingsSchema = z.object({});

export const getSettingsTool = tool(
  async () => {
    const settings = getSettingsSync();
    return JSON.stringify(settings);
  },
  {
    name: "get_settings",
    description: "Return the current Edda configuration settings.",
    schema: getSettingsSchema,
  },
);
