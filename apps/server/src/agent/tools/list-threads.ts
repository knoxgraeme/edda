/**
 * Tool: list_threads — List recent conversation threads ordered by last activity.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { listThreads } from "@edda/db";

export const listThreadsSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of threads to return"),
});

export const listThreadsTool = tool(
  async ({ limit }) => {
    const threads = await listThreads(limit);
    return JSON.stringify(threads);
  },
  {
    name: "list_threads",
    description:
      "List recent conversation threads ordered by last activity, including thread ID, title, and metadata.",
    schema: listThreadsSchema,
  },
);
