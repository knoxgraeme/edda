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
import { resolveRetrievalContext, extractLastAssistantMessage } from "../tool-helpers.js";
import { runWithConcurrencyLimit } from "../../utils/semaphore.js";
import { sanitizeError } from "../../utils/sanitize-error.js";
import { withTimeout } from "../../utils/with-timeout.js";
import { deliverRunResults } from "../../utils/notify.js";
import { getLogger } from "../../logger.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export const runAgentSchema = z.object({
  agent_name: z.string().describe("Name of the agent to run"),
  input: z.string().optional().describe("Optional task input or instructions"),
  notify: z
    .array(z.string().min(1).max(200))
    .max(20)
    .optional()
    .describe("Optional notification targets (e.g. ['inbox', 'announce:edda'])"),
});

export const runAgentTool = tool(
  async ({ agent_name, input, notify: notifyTargets }) => {
    const definition = await getAgentByName(agent_name);
    if (!definition) throw new Error(`Agent '${agent_name}' not found`);
    if (!definition.enabled) throw new Error(`Agent '${agent_name}' is disabled`);

    // Force ephemeral thread
    const threadId = resolveThreadId({ ...definition, thread_lifetime: "ephemeral" });
    const settings = await refreshSettings();
    const modelName = definition.model || settings.default_model;

    const run = await createTaskRun({
      agent_id: definition.id,
      agent_name: definition.name,
      trigger: "orchestrator",
      thread_id: threadId,
      model: modelName,
    });

    // Fire-and-forget with task_run tracking and concurrency control
    setImmediate(() => {
      runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
        const startTime = Date.now();
        try {
          await startTaskRun(run.id);
          const agent = await buildAgent(definition);
          const message = input ?? `Execute the ${definition.name} task now.`;
          const result = (await withTimeout(
            agent.invoke(
              { messages: [{ role: "user", content: message }] },
              {
                configurable: {
                  thread_id: threadId,
                  agent_name: definition.name,
                  retrieval_context: resolveRetrievalContext(definition.metadata, definition.name),
                },
              },
            ),
            AGENT_TIMEOUT_MS,
            definition.name,
          )) as Parameters<typeof extractLastAssistantMessage>[0];
          const lastMessage = extractLastAssistantMessage(result);
          await completeTaskRun(run.id, {
            output_summary: lastMessage?.slice(0, 500),
            duration_ms: Date.now() - startTime,
          });

          await deliverRunResults({
            agentId: definition.id,
            agentName: definition.name,
            runId: run.id,
            lastMessage,
            targets: notifyTargets ?? [],
            sourceType: "system",
            sourceId: run.id,
          });
        } catch (err) {
          getLogger().error({ agent: definition.name, runId: run.id, err }, "run_agent failed");
          await failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
            getLogger().error({ runId: run.id, err: dbErr }, "Failed to record run_agent failure");
          });

          await deliverRunResults({
            agentId: definition.id,
            agentName: definition.name,
            runId: run.id,
            lastMessage: undefined,
            targets: notifyTargets ?? [],
            sourceType: "system",
            sourceId: run.id,
            error: err,
          });
        }
      }).catch((err) => {
        getLogger().error({ agent: definition.name, err }, "run_agent concurrency/setup failure");
        failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
          getLogger().error({ runId: run.id, err: dbErr }, "Failed to record run_agent failure");
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
    description: [
      "Trigger a BACKGROUND run of a named agent.",
      "Returns immediately with a task_run_id — the agent runs asynchronously",
      "and you will NOT receive its output. Use list_my_runs to check status.",
      "Prefer the `task` tool when you need the result inline",
      "(e.g. research, analysis, memory extraction).",
    ].join(" "),
    schema: runAgentSchema,
  },
);
