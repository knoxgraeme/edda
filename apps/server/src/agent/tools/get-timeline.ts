/**
 * Tool: get_timeline — Retrieve items within a date range.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getTimeline } from "@edda/db";

export const getTimelineSchema = z.object({
  start: z.string().describe("Start date (YYYY-MM-DD)"),
  end: z.string().describe("End date (YYYY-MM-DD)"),
  types: z.array(z.string()).optional().describe("Filter by item types"),
});

export const getTimelineTool = tool(
  async ({ start, end, types }) => {
    const items = await getTimeline(start, end, types);
    return JSON.stringify({
      start,
      end,
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        content: item.content,
        summary: item.summary,
        day: item.day,
        status: item.status,
        metadata: item.metadata,
      })),
    });
  },
  {
    name: "get_timeline",
    description: "Retrieve confirmed items within a date range, optionally filtered by type.",
    schema: getTimelineSchema,
  },
);
