/**
 * Shared agent run executor — start/invoke/complete/fail lifecycle.
 */

import { startTaskRun, completeTaskRun, failTaskRun } from "@edda/db";
import type { Agent } from "@edda/db";
import { getOrBuildAgent } from "./agent-cache.js";
import { extractLastAssistantMessage, extractTotalTokens } from "./tool-helpers.js";
import { sanitizeError } from "../utils/sanitize-error.js";
import { withTimeout } from "../utils/with-timeout.js";
import { getLogger, withTraceId } from "../logger.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface AgentResult {
  messages?: Array<{
    role?: string;
    content?: unknown;
    _getType?: () => string;
    usage_metadata?: { total_tokens?: number };
  }>;
}

export async function executeAgentRun(opts: {
  agentDef: Agent;
  runId: string;
  threadId: string;
  prompt: string;
  trigger: string;
}): Promise<string | undefined> {
  const { agentDef, runId, threadId, prompt, trigger } = opts;
  return withTraceId({ module: "run", agent: agentDef.name, runId, trigger }, async () => {
    const startTime = Date.now();
    try {
      await startTaskRun(runId);
      getLogger().info({ agent: agentDef.name, runId, trigger }, "Executing agent run");

      const state = await getOrBuildAgent(agentDef.name);
      if (!state) throw new Error(`Agent "${agentDef.name}" not found or disabled`);

      const result: AgentResult = await withTimeout(
        state.agent.invoke(
          { messages: [{ role: "user", content: prompt }] },
          {
            configurable: {
              thread_id: threadId,
              agent_name: agentDef.name,
              retrieval_context: state.retrievalContext,
            },
            runName: `${agentDef.name}/${trigger}`,
            metadata: { agent_name: agentDef.name, trigger, run_id: runId, thread_id: threadId },
            tags: [agentDef.name, trigger],
          },
        ),
        AGENT_TIMEOUT_MS,
        agentDef.name,
      );

      const duration = Date.now() - startTime;
      const lastMessage = extractLastAssistantMessage(result);
      await completeTaskRun(runId, {
        output_summary: lastMessage?.slice(0, 500),
        tokens_used: extractTotalTokens(result),
        duration_ms: duration,
      });
      getLogger().info({ agent: agentDef.name, runId, durationMs: duration }, "Agent run completed");
      return lastMessage;
    } catch (err) {
      getLogger().error({ agent: agentDef.name, runId, err }, "Agent run failed");
      await failTaskRun(runId, sanitizeError(err)).catch((dbErr) =>
        getLogger().error({ runId, err: dbErr }, "Failed to record task_run failure"),
      );
      throw err;
    }
  });
}
