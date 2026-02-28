/**
 * Patch @langchain/anthropic's tool schema serialization.
 *
 * Anthropic's API requires input_schema.type === "object" on every tool.
 * LangChain's formatStructuredToolToAnthropic passes non-Zod schemas
 * through as-is (chat_models.js line ~705), trusting they're valid.
 * This can fail when:
 * - MCP servers return schemas without an explicit "type" field
 * - simplifyJsonSchemaForLLM strips "type" during allOf/anyOf merging
 * - Future LangChain/MCP changes introduce new schema edge cases
 *
 * This wraps formatStructuredToolToAnthropic to ensure every tool's
 * input_schema has type: "object" after LangChain's conversion — the
 * last line of defense before the Anthropic API call.
 */

import { ChatAnthropicMessages } from "@langchain/anthropic";
import { getLogger } from "../logger.js";

export function patchAnthropicToolSchemas(): void {
  const proto = ChatAnthropicMessages.prototype;
  const original = proto.formatStructuredToolToAnthropic;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const patched = function (this: any, tools: any) {
    const formatted = original.call(this, tools) as any[] | undefined;
    if (!formatted) return formatted;

    for (const tool of formatted) {
      const schema = tool.input_schema;
      if (schema && typeof schema === "object" && schema.type !== "object") {
        getLogger().warn(
          { tool: tool.name, originalType: schema.type ?? "(missing)" },
          "Patched non-object input_schema.type for Anthropic API",
        );
        schema.type = "object";
        if (!schema.properties) {
          schema.properties = {};
        }
      }
    }

    return formatted;
  };
  proto.formatStructuredToolToAnthropic = patched as typeof original;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
