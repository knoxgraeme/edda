/**
 * Tool: get_task_run — Check status and results of recent agent runs.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getRecentTaskRuns, getTaskRunById } from "@edda/db";

export const getTaskRunSchema = z.object({
  task_run_id: z.string().uuid().optional().describe("Look up a specific task run by ID"),
  agent_name: z.string().optional().describe("Filter by agent name"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Number of runs to return"),
});

export const getTaskRunTool = tool(
  async ({ task_run_id, agent_name, limit }) => {
    if (task_run_id) {
      const run = await getTaskRunById(task_run_id);
      if (!run) return JSON.stringify({ error: `Task run '${task_run_id}' not found` });
      return JSON.stringify(run);
    }
    const runs = await getRecentTaskRuns({ agent_name, limit });
    return JSON.stringify(
      runs.map((r) => ({
        id: r.id,
        agent_name: r.agent_name,
        trigger: r.trigger,
        status: r.status,
        output_summary: r.output_summary?.slice(0, 300),
        duration_ms: r.duration_ms,
        error: r.error?.slice(0, 200),
        started_at: r.started_at,
        completed_at: r.completed_at,
      })),
    );
  },
  {
    name: "get_task_run",
    description:
      "Check the status and results of recent agent runs. Use after run_agent to see if the task completed.",
    schema: getTaskRunSchema,
  },
);
