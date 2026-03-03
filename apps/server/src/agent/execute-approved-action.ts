/**
 * Execute an approved pending action by invoking the original tool directly.
 *
 * After a user approves a gated tool call, this module finds the original
 * (unwrapped) tool and invokes it with the stored arguments. If the action
 * has a thread_id (conversational flow), it injects the result back into
 * the agent's thread.
 */

import type { PendingAction } from "@edda/db";
import { allTools, loadCommunityTools } from "./tools/index.js";
import { loadMCPTools } from "../mcp/client.js";
import { getOrBuildAgent } from "./agent-cache.js";
import { getLogger } from "../logger.js";

/**
 * Find the original tool by name from all available tool pools.
 */
async function findTool(toolName: string) {
  // Check built-in tools first
  const builtIn = allTools.find((t) => t.name === toolName);
  if (builtIn) return builtIn;

  // Check MCP tools
  const mcpTools = await loadMCPTools();
  const mcp = mcpTools.find((t) => t.name === toolName);
  if (mcp) return mcp;

  // Check community tools
  const community = await loadCommunityTools();
  return community.find((t) => t.name === toolName) ?? null;
}

/**
 * Execute an approved action: invoke the original tool, optionally inject
 * the result into the agent's thread.
 */
export async function executeApprovedAction(action: PendingAction): Promise<string> {
  const log = getLogger();
  const tool = await findTool(action.tool_name);
  if (!tool) {
    throw new Error(`Tool "${action.tool_name}" not found for approved action ${action.id}`);
  }

  log.info(
    { actionId: action.id, tool: action.tool_name, agent: action.agent_name },
    "Executing approved action",
  );

  // Invoke the tool directly with stored args
  const configurable = (action.run_context as Record<string, unknown>).configurable ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- union of StructuredTool invoke signatures are incompatible
  const result = await (tool as any).invoke(action.tool_input, { configurable });

  // If there's a thread, inject the result back into the agent's conversation
  if (action.thread_id) {
    try {
      const state = await getOrBuildAgent(action.agent_name);
      if (state) {
        const message = `[Approved action result] The user approved "${action.tool_name}". Result: ${typeof result === "string" ? result : JSON.stringify(result)}`;
        await state.agent.invoke(
          { messages: [{ role: "user", content: message }] },
          {
            configurable: {
              thread_id: action.thread_id,
              agent_name: action.agent_name,
              ...(state.retrievalContext ? { retrieval_context: state.retrievalContext } : {}),
            },
          },
        );
      }
    } catch (err) {
      log.warn({ actionId: action.id, err }, "Failed to inject approved action result into thread");
    }
  }

  return typeof result === "string" ? result : JSON.stringify(result);
}
