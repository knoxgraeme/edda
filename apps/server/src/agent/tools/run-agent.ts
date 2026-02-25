/**
 * Tool: run_agent — Trigger an on-demand run of an agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getAgentByName,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import { buildAgent, resolveThreadId } from "../build-agent.js";
import { runWithConcurrencyLimit } from "../../cron/semaphore.js";
import { sanitizeError } from "../../utils/sanitize-error.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export const runAgentSchema = z.object({
  agent_name: z.string().describe("Name of the agent to run"),
  input: z.string().optional().describe("Optional task input or instructions"),
});

export const runAgentTool = tool(
  async ({ agent_name, input }) => {
    const definition = await getAgentByName(agent_name);
    if (!definition) throw new Error(`Agent '${agent_name}' not found`);
    if (!definition.enabled) throw new Error(`Agent '${agent_name}' is disabled`);

    const threadId = resolveThreadId(definition);
    const run = await createTaskRun({
      agent_id: definition.id,
      agent_name: definition.name,
      trigger: "orchestrator",
      thread_id: threadId,
    });

    // Fire-and-forget with task_run tracking and concurrency control
    const settings = await refreshSettings();
    setImmediate(() => {
      runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
        const startTime = Date.now();
        try {
          await startTaskRun(run.id);
          const agent = await buildAgent(definition);
          const message = input ?? `Execute the ${definition.name} task now.`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result: any = await withTimeout(
            agent.invoke(
              { messages: [{ role: "user", content: message }] },
              { configurable: { thread_id: threadId, agent_name: definition.name } },
            ),
            AGENT_TIMEOUT_MS,
            definition.name,
          );
          const lastMsg = result?.messages?.[result.messages.length - 1]?.content;
          await completeTaskRun(run.id, {
            output_summary: typeof lastMsg === "string" ? lastMsg.slice(0, 500) : undefined,
            duration_ms: Date.now() - startTime,
          });
        } catch (err) {
          console.error(`[run_agent] ${definition.name}:`, err);
          await failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
            console.error(`[run_agent] Failed to record failure for ${run.id}:`, dbErr);
          });
        }
      }).catch((err) => {
        console.error(`[run_agent] Concurrency/setup failure for ${definition.name}:`, err);
        failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
          console.error(`[run_agent] Failed to record failure for ${run.id}:`, dbErr);
        });
      });
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
      "Trigger an on-demand run of an agent. Returns immediately with a task_run_id you can check later.",
    schema: runAgentSchema,
  },
);
