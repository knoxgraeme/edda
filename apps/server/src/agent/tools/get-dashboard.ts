/**
 * Tool: get_dashboard — Retrieve the daily dashboard overview.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getDashboard } from "@edda/db";

export const getDashboardSchema = z.object({
  date: z.string().optional().describe("YYYY-MM-DD date for the dashboard (defaults to today)"),
});

export const getDashboardTool = tool(
  async ({ date }) => {
    const data = await getDashboard(date);
    return JSON.stringify(data);
  },
  {
    name: "get_dashboard",
    description:
      "Get the daily dashboard: due today, captured today, open items, lists, and pending confirmations.",
    schema: getDashboardSchema,
  },
);
