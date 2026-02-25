/**
 * Tool: get_daily_summary — Retrieve the daily overview.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getDashboard } from "@edda/db";

export const getDailySummarySchema = z.object({
  date: z.string().optional().describe("YYYY-MM-DD date for the summary (defaults to today)"),
});

export const getDailySummaryTool = tool(
  async ({ date }) => {
    const data = await getDashboard(date);
    return JSON.stringify(data);
  },
  {
    name: "get_daily_summary",
    description:
      "Get the daily summary: due today, captured today, open items, lists, and pending confirmations.",
    schema: getDailySummarySchema,
  },
);
