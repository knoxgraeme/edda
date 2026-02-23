/**
 * Tool: mark_thread_processed — Mark a conversation thread as processed by the memory extraction hook.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { setThreadMetadata } from "@edda/db";

export const markThreadProcessedSchema = z.object({
  thread_id: z.string().uuid().describe("The thread ID to mark as processed"),
});

export const markThreadProcessedTool = tool(
  async ({ thread_id }) => {
    await setThreadMetadata(thread_id, {
      processed_by_hook: true,
      processed_at: new Date().toISOString(),
    });
    return JSON.stringify({ success: true, thread_id });
  },
  {
    name: "mark_thread_processed",
    description: "Mark a conversation thread as processed by the memory extraction hook.",
    schema: markThreadProcessedSchema,
  },
);
