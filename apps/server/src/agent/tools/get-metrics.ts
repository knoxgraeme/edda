/**
 * Tool: get_metrics — Retrieve system and per-agent execution metrics.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentMetrics, getSystemMetrics } from "@edda/db";

export const getMetricsSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7)
    .describe("Number of days to look back for per-agent metrics (1-90, default 7)"),
});

export const getMetricsTool = tool(
  async ({ days }) => {
    const [agentMetrics, systemMetrics] = await Promise.all([
      getAgentMetrics(days),
      getSystemMetrics(),
    ]);
    return JSON.stringify({ system: systemMetrics, agents: agentMetrics });
  },
  {
    name: "get_metrics",
    description:
      "Get system health metrics (running/completed/failed counts, token usage) and per-agent execution stats over a configurable time window.",
    schema: getMetricsSchema,
  },
);
