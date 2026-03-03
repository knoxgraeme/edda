/**
 * Shared config helpers for agent tools.
 */

import { z } from "zod";
import type { RetrievalContext } from "@edda/db";
import { stripReasoningBlocks } from "../utils/strip-reasoning.js";

/** Extract agent_name from LangGraph config with runtime type guard. */
export function getAgentName(
  config?: { configurable?: Record<string, unknown> },
): string | undefined {
  const name = config?.configurable?.agent_name;
  return typeof name === "string" ? name : undefined;
}

/** Zod schema for validating retrieval_context from agent metadata. */
export const RetrievalContextSchema = z.object({
  authors: z.array(z.string()).optional(),
  authorship_mode: z.enum(["boost", "filter"]).optional(),
  authorship_boost: z.number().optional(),
  types: z.array(z.string()).optional(),
  type_mode: z.enum(["boost", "filter"]).optional(),
  type_boost: z.number().optional(),
});

/** Extract the last assistant/AI message from an agent result. */
export function extractLastAssistantMessage(result: {
  messages?: Array<{ role?: string; content?: unknown; _getType?: () => string }>;
}): string | undefined {
  const messages = result?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if ((m.role === "assistant" || m._getType?.() === "ai") && typeof m.content === "string") {
      return stripReasoningBlocks(m.content);
    }
  }
  return undefined;
}

/**
 * Resolve retrieval context from an agent's metadata.
 * Validates the shape, applies default-authors logic, and returns undefined
 * if no retrieval context is configured.
 */
export function resolveRetrievalContext(
  metadata: Record<string, unknown> | undefined,
  agentName: string,
): RetrievalContext | undefined {
  const parsed = RetrievalContextSchema.safeParse(metadata?.retrieval_context);
  const rc = parsed.success ? parsed.data : undefined;
  if (!rc || (!rc.authorship_mode && !rc.type_mode)) return undefined;
  return {
    ...rc,
    // Default authors to [self] when authorship_mode is set but authors omitted
    authors: rc.authorship_mode
      ? (rc.authors?.length ? rc.authors : [agentName])
      : undefined,
  };
}
