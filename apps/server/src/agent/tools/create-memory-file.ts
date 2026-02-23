/**
 * Tool: create_memory_file — Write a synthesized memory file to PostgresStore.
 *
 * Used by the memory_sync cron agent to persist entity briefs into the
 * /memories/ namespace. NOT registered in the main agent's tool set —
 * only available to cron agents (see standalone.ts).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStore } from "../../store/index.js";
import { MEMORY_PATH_REGEX } from "../memory-paths.js";
import type { MemoryFileRecord } from "../memory-paths.js";

export const createMemoryFileSchema = z.object({
  path: z
    .string()
    .regex(
      MEMORY_PATH_REGEX,
      "Path must be /<type>/<slug> (e.g. /people/sarah, /projects/atlas)",
    )
    .describe(
      "Store path for the memory file, e.g. /people/sarah or /projects/atlas",
    ),
  content: z
    .string()
    .max(5000, "Memory file content must be under 5000 characters")
    .describe("The synthesized memory file content (markdown brief)"),
  memory_type: z
    .enum(["people", "projects", "organizations"])
    .describe("The memory type directory name"),
  entity_id: z
    .string()
    .optional()
    .describe("The entity ID this memory file is about"),
  source: z
    .enum(["cron", "hotpatch"])
    .describe("Whether this was created by cron synthesis or hotpatch triage"),
});

export const createMemoryFileTool = tool(
  async ({ path, content, memory_type, entity_id, source }) => {
    const store = await getStore();
    const now = new Date().toISOString();

    const record: MemoryFileRecord = {
      content: content.split("\n"),
      created_at: now,
      modified_at: now,
      memory_type,
      entity_id,
      source,
    };

    await store.put(["filesystem"], path, record);

    return JSON.stringify({ path, source });
  },
  {
    name: "create_memory_file",
    description:
      "Write a synthesized memory file to the /memories/ store. Used by cron agents to persist entity briefs. Path must be /<type>/<slug> format.",
    schema: createMemoryFileSchema,
  },
);
