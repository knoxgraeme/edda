/**
 * Monkey-patch @langchain/anthropic's tool schema serialization.
 *
 * Anthropic's API requires input_schema.type === "object" on every tool.
 * LangChain's formatStructuredToolToAnthropic can produce schemas missing
 * this field when:
 * - MCP tools have non-object schemas after simplifyJsonSchemaForLLM
 * - Zod schemas produce unexpected output via toJsonSchema()
 * - Middleware-injected tools (deepagents) bypass build-time normalization
 *
 * This patch wraps the original method to fix schemas AFTER conversion,
 * right before they're sent to the Anthropic API — catching all tools
 * regardless of source.
 */

import { ChatAnthropicMessages } from "@langchain/anthropic";
import { getLogger } from "../logger.js";

interface AnthropicTool {
  name?: string;
  input_schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export function patchAnthropicToolSchemas(): void {
  const proto = ChatAnthropicMessages.prototype;
  const original = proto.formatStructuredToolToAnthropic;

  proto.formatStructuredToolToAnthropic = function (tools: unknown[]) {
    const formatted = original.call(this, tools) as AnthropicTool[] | undefined;
    if (!formatted) return formatted;

    for (const tool of formatted) {
      const schema = tool.input_schema;
      if (schema && typeof schema === "object" && schema.type !== "object") {
        getLogger().debug(
          { tool: tool.name, originalType: schema.type ?? "(missing)" },
          "Anthropic patch: fixed non-object input_schema.type",
        );
        schema.type = "object";
        if (!schema.properties) {
          schema.properties = {};
        }
      }
    }

    return formatted;
  };
}
