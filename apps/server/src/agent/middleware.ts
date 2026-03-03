import {
  toolCallLimitMiddleware,
  modelCallLimitMiddleware,
  contextEditingMiddleware,
  ClearToolUsesEdit,
  modelRetryMiddleware,
  createMiddleware,
} from "langchain";
import type { AgentMiddleware } from "langchain";
import type { Agent } from "@edda/db";

/**
 * Known parameter aliases that LLMs use instead of the canonical names.
 * Key = tool name, value = map of alias → canonical name.
 */
const TOOL_ARG_ALIASES: Record<string, Record<string, string>> = {
  execute: { cmd: "command" },
};

/**
 * Middleware that normalizes common tool argument aliases before validation.
 * Some LLMs (especially non-Anthropic) use variant parameter names like
 * "cmd" instead of "command". This catches those before Zod rejects them.
 */
function toolArgNormalizerMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: "toolArgNormalizer",
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall?.name;
      const args = request.toolCall?.args;
      if (toolName && args && TOOL_ARG_ALIASES[toolName]) {
        const aliases = TOOL_ARG_ALIASES[toolName];
        for (const [alias, canonical] of Object.entries(aliases)) {
          if (alias in args && !(canonical in args)) {
            args[canonical] = args[alias];
            delete args[alias];
          }
        }
      }
      return handler(request);
    },
  });
}

const DEFAULTS = {
  toolCallRunLimit: 30,
  modelCallRunLimit: 15,
  contextEditingTriggerTokens: 80_000,
  contextEditingKeepMessages: 5,
};

export function buildMiddleware(agent: Agent): AgentMiddleware[] {
  const config = agent.metadata?.middleware as Record<string, unknown> | undefined;

  const middleware: AgentMiddleware[] = [];

  // Normalize common tool argument aliases (e.g. cmd → command for execute)
  middleware.push(toolArgNormalizerMiddleware());

  // Tool call limit (global default + optional per-tool overrides)
  const toolRunLimit = (config?.toolCallRunLimit as number) ?? DEFAULTS.toolCallRunLimit;
  middleware.push(toolCallLimitMiddleware({ runLimit: toolRunLimit, exitBehavior: "continue" }));

  // Per-tool overrides: metadata.middleware.toolLimits = { "web_search": 5, "execute": 3 }
  const toolLimits = config?.toolLimits as Record<string, number> | undefined;
  if (toolLimits) {
    for (const [toolName, limit] of Object.entries(toolLimits)) {
      middleware.push(toolCallLimitMiddleware({ toolName, runLimit: limit, exitBehavior: "continue" }));
    }
  }

  // Model call limit (hard safety stop)
  const modelRunLimit = (config?.modelCallRunLimit as number) ?? DEFAULTS.modelCallRunLimit;
  middleware.push(modelCallLimitMiddleware({ runLimit: modelRunLimit, exitBehavior: "end" }));

  // Context editing (clear old tool results when context grows large)
  const triggerTokens =
    (config?.contextEditingTriggerTokens as number) ?? DEFAULTS.contextEditingTriggerTokens;
  const keepMessages =
    (config?.contextEditingKeepMessages as number) ?? DEFAULTS.contextEditingKeepMessages;
  const excludeTools = (config?.contextEditingExcludeTools as string[]) ?? [];
  middleware.push(
    contextEditingMiddleware({
      edits: [
        new ClearToolUsesEdit({
          trigger: { tokens: triggerTokens },
          keep: { messages: keepMessages },
          excludeTools,
          placeholder: "[cleared]",
        }),
      ],
    }),
  );

  // Model retry (transient failures only)
  middleware.push(
    modelRetryMiddleware({
      maxRetries: 2,
      retryOn: (err: unknown) => {
        const status = (err as { status?: number })?.status;
        return status === 429 || status === 500 || status === 503;
      },
      backoffFactor: 2.0,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      jitter: true,
      onFailure: "error",
    }),
  );

  return middleware;
}
