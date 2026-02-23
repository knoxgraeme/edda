/**
 * Tool: get_unprocessed_threads — Retrieve threads not yet processed by the memory extraction hook.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getUnprocessedThreads } from "@edda/db";

export const getUnprocessedThreadsSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of threads to return"),
});

export const getUnprocessedThreadsTool = tool(
  async ({ limit }) => {
    const threads = await getUnprocessedThreads(limit);
    return JSON.stringify(threads);
  },
  {
    name: "get_unprocessed_threads",
    description:
      "Get conversation threads that haven't been processed by the memory extraction hook yet.",
    schema: getUnprocessedThreadsSchema,
  },
);
