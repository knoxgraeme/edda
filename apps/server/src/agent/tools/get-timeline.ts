/**
 * Tool: get_timeline — Retrieve items within a date range.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getTimeline } from "@edda/db";

export const getTimelineSchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
    .describe("Start date (YYYY-MM-DD)"),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
    .describe("End date (YYYY-MM-DD)"),
  types: z.array(z.string()).optional().describe("Filter by item types"),
  limit: z.number().int().min(1).max(100).optional().describe("Max items to return"),
});

export const getTimelineTool = tool(
  async ({ start, end, types, limit }) => {
    const items = await getTimeline(start, end, types, limit);
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
