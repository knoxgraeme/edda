/**
 * Tool: run_agent — Trigger an on-demand run of a background agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getAgentDefinitionByName,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
} from "@edda/db";
import { buildChannelAgent, resolveThreadId } from "../build-channel-agent.js";

export const runAgentSchema = z.object({
  agent_name: z.string().describe("Name of the agent to run"),
  input: z.string().optional().describe("Optional task input or instructions"),
});

export const runAgentTool = tool(
  async ({ agent_name, input }) => {
    const definition = await getAgentDefinitionByName(agent_name);
    if (!definition) throw new Error(`Agent '${agent_name}' not found`);
    if (!definition.enabled) throw new Error(`Agent '${agent_name}' is disabled`);

    const threadId = resolveThreadId(definition);
    const run = await createTaskRun({
      agent_definition_id: definition.id,
      agent_name: definition.name,
      trigger: "orchestrator",
      thread_id: threadId,
    });

    // Fire-and-forget with task_run tracking
    setImmediate(async () => {
      const startTime = Date.now();
      try {
        await startTaskRun(run.id);
        const agent = await buildChannelAgent(definition);
        const message = input ?? `Execute the ${definition.name} task now.`;
        const result = await agent.invoke(
          { messages: [{ role: "user", content: message }] },
          { configurable: { thread_id: threadId, agent_name: definition.name } },
        );
        const lastMsg = result?.messages?.[result.messages.length - 1]?.content;
        await completeTaskRun(run.id, {
          output_summary: typeof lastMsg === "string" ? lastMsg.slice(0, 500) : undefined,
          duration_ms: Date.now() - startTime,
        });
      } catch (err) {
        await failTaskRun(run.id, err instanceof Error ? err.message : String(err));
      }
    });

    return JSON.stringify({
      started: true,
      task_run_id: run.id,
      agent_name,
      thread_id: threadId,
    });
  },
  {
    name: "run_agent",
    description:
      "Trigger an on-demand run of a background agent. Returns immediately with a task_run_id you can check later.",
    schema: runAgentSchema,
  },
);
