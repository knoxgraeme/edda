/**
 * Tool: get_thread_messages — Retrieve normalized messages from a conversation thread.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
// Checkpointer is a server-side concern (LangGraph state), not a DB query — direct import is intentional.
import { getSharedCheckpointer } from "../../checkpointer.js";

interface RawCheckpointMessage {
  _getType?: () => string;
  type?: string;
  content?: unknown;
  name?: string;
}

interface NormalizedMessage {
  type: "human" | "ai" | "tool" | "system";
  content: string | unknown[];
  name?: string;
}

export const getThreadMessagesSchema = z.object({
  thread_id: z
    .string()
    .max(200)
    .regex(/^[a-zA-Z0-9_:-]+$/)
    .describe("The thread ID to retrieve messages from"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of recent messages to return"),
});

export const getThreadMessagesTool = tool(
  async ({ thread_id, limit }) => {
    const checkpointer = getSharedCheckpointer();
    if (!checkpointer) {
      throw new Error("Checkpointer not ready");
    }

    const tuple = await checkpointer.getTuple({ configurable: { thread_id } });
    if (!tuple) {
      return JSON.stringify([]);
    }

    const rawMessages = tuple.checkpoint?.channel_values?.messages ?? [];
    const messages: NormalizedMessage[] = (rawMessages as RawCheckpointMessage[]).map((m) => {
      const msgType = String(
        typeof m._getType === "function" ? m._getType() : (m.type ?? "ai"),
      );
      let type: NormalizedMessage["type"];
      if (msgType === "human" || msgType === "HumanMessage") type = "human";
      else if (msgType === "tool" || msgType === "ToolMessage") type = "tool";
      else if (msgType === "system" || msgType === "SystemMessage") type = "system";
      else type = "ai";

      let content: string | unknown[] = m.content as string | unknown[] ?? "";
      if (typeof content !== "string" && !Array.isArray(content)) {
        content = String(content);
      }

      return { type, content, name: m.name };
    });

    return JSON.stringify(messages.slice(-limit));
  },
  {
    name: "get_thread_messages",
    description: "Retrieve recent messages from a conversation thread by its thread ID.",
    schema: getThreadMessagesSchema,
  },
);
