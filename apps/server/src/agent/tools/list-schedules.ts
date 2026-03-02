/**
 * Tool: list_schedules — List cron schedules for an agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentByName, getSchedulesForAgent } from "@edda/db";

export const listSchedulesSchema = z.object({
  agent_name: z.string().min(1).describe("Name of the agent to list schedules for"),
});

export const listSchedulesTool = tool(
  async ({ agent_name }) => {
    const agent = await getAgentByName(agent_name);
    if (!agent) throw new Error(`Agent not found: ${agent_name}`);

    const schedules = await getSchedulesForAgent(agent.id);

    return JSON.stringify(
      schedules.map((s) => ({
        schedule_id: s.id,
        name: s.name,
        cron: s.cron,
        prompt: s.prompt.length > 200 ? s.prompt.slice(0, 200) + "…" : s.prompt,
        thread_lifetime: s.thread_lifetime,
        enabled: s.enabled,
        notify: s.notify,
        notify_expires_after: s.notify_expires_after,
      })),
    );
  },
  {
    name: "list_schedules",
    description:
      "List all cron schedules for an agent. Shows schedule name, cron expression, prompt (truncated), and status.",
    schema: listSchedulesSchema,
  },
);
