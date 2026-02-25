/**
 * list_my_runs — lets agents query their own past task runs.
 *
 * An isolated-context agent can still know "I ran 3 times this week
 * and failed once" regardless of context_mode.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { getRecentTaskRuns } from "@edda/db";

export const listMyRunsSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of past runs to return"),
});

export const listMyRunsTool = tool(
  async ({ limit }, config) => {
    const agentName = config?.configurable?.agent_name as string | undefined;
    if (!agentName) throw new Error("agent_name required in configurable");

    const runs = await getRecentTaskRuns({ agent_name: agentName, limit });
    return JSON.stringify(
      runs.map((r) => ({
        status: r.status,
        output_summary: r.output_summary?.slice(0, 200),
        started_at: r.started_at,
        duration_ms: r.duration_ms,
        error: r.error?.slice(0, 100),
      })),
    );
  },
  {
    name: "list_my_runs",
    description:
      "Get your own recent execution history — status, output summaries, timing, and errors from past runs.",
    schema: listMyRunsSchema,
  },
);
