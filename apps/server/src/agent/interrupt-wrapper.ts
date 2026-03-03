/**
 * Interrupt wrapper — wraps tools that require user confirmation before execution.
 *
 * For tools with interrupt level 'always', the wrapper intercepts the call,
 * creates a pending_actions row, and returns a structured response to the agent
 * indicating the tool call is awaiting approval.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import type { StructuredTool } from "@langchain/core/tools";
import { createPendingAction } from "@edda/db";
import type { InterruptLevel } from "./tools/index.js";

/** Extract only JSON-safe scalar keys from configurable to avoid circular refs. */
function safeRunContext(configurable?: Record<string, unknown>): Record<string, unknown> {
  if (!configurable) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(configurable)) {
    if (val === null || val === undefined || typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      safe[key] = val;
    }
  }
  return { configurable: safe };
}

export interface InterruptConfig {
  defaults: Record<string, InterruptLevel>;
  overrides: Record<string, InterruptLevel>;
  agentName: string;
  ttl: string; // PostgreSQL interval, default '1 hour'
}

/**
 * Wrap tools that have interrupt level 'always' with a gating function.
 * The wrapper creates a pending_actions row and returns a structured JSON
 * response to the agent (not an error).
 */
export function wrapInterruptibleTools(
  tools: StructuredTool[],
  config: InterruptConfig,
): StructuredTool[] {
  return tools.map((tool) => {
    const level = config.overrides[tool.name] ?? config.defaults[tool.name] ?? "never";
    if (level !== "always") return tool;
    return wrapTool(tool, config);
  });
}

function wrapTool(tool: StructuredTool, config: InterruptConfig): StructuredTool {
  return new DynamicStructuredTool({
    name: tool.name,
    description: `${tool.description} [Requires confirmation]`,
    schema: tool.schema,
    func: async (input, runManager, toolConfig) => {
      const threadId =
        (toolConfig?.configurable as Record<string, unknown> | undefined)?.thread_id as
          | string
          | undefined;

      const action = await createPendingAction({
        agent_name: config.agentName,
        tool_name: tool.name,
        tool_input: input as Record<string, unknown>,
        description: `${tool.name} called with: ${JSON.stringify(input).slice(0, 200)}`,
        thread_id: threadId ?? null,
        run_context: safeRunContext(toolConfig?.configurable),
        ttl: config.ttl,
      });

      return JSON.stringify({
        interrupted: true,
        pending_action_id: action.id,
        tool_name: tool.name,
        message: `This action requires user confirmation before it can be executed. A confirmation request has been created (ID: ${action.id}). Please inform the user that "${tool.name}" is awaiting their approval.`,
      });
    },
  });
}
