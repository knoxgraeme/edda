/**
 * Tool: get_task_result — Check status and results of recent agent runs.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getRecentTaskRuns } from "@edda/db";

export const getTaskResultSchema = z.object({
  agent_name: z.string().optional().describe("Filter by agent name"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Number of runs to return"),
});

export const getTaskResultTool = tool(
  async ({ agent_name, limit }) => {
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
    name: "get_task_result",
    description:
      "Check the status and results of recent agent runs. Use after run_agent to see if the task completed.",
    schema: getTaskResultSchema,
  },
);
