/**
 * Patch @langchain/anthropic's tool schema serialization.
 *
 * Anthropic's API requires every tool's input_schema to:
 * 1. Have type: "object" at the top level
 * 2. Not contain oneOf, allOf, or anyOf at the top level
 *
 * LangChain's formatStructuredToolToAnthropic passes non-Zod schemas
 * through as-is (chat_models.js line ~705), trusting they're valid.
 * Even Zod schemas can produce invalid output — e.g. z.discriminatedUnion
 * serializes to { anyOf: [...] } without type: "object".
 *
 * This wraps formatStructuredToolToAnthropic as a last line of defense
 * before the Anthropic API call.
 */

import { ChatAnthropicMessages } from "@langchain/anthropic";
import { getLogger } from "../logger.js";

/**
 * Flatten a top-level anyOf/oneOf discriminated union into a single
 * object schema with an enum discriminator. This mirrors what Anthropic
 * expects — a flat object with all possible properties.
 */
function flattenTopLevelUnion(schema: Record<string, unknown>): Record<string, unknown> {
  const unionKey = "anyOf" in schema ? "anyOf" : "oneOf" in schema ? "oneOf" : null;
  if (!unionKey) return schema;

  const variants = schema[unionKey] as Record<string, unknown>[];
  if (!Array.isArray(variants) || variants.length === 0) return schema;

  // Check if all variants are objects
  const allObjects = variants.every(
    (v) => v.type === "object" || (v.properties && typeof v.properties === "object"),
  );
  if (!allObjects) return schema;

  // Merge all properties from all variants
  const mergedProperties: Record<string, unknown> = {};
  const allRequired = new Set<string>();

  for (const variant of variants) {
    const props = (variant.properties ?? {}) as Record<string, unknown>;
    for (const [key, val] of Object.entries(props)) {
      if (!(key in mergedProperties)) {
        mergedProperties[key] = val;
      } else {
        // If same key appears in multiple variants with const/enum, merge into enum
        const existing = mergedProperties[key] as Record<string, unknown>;
        const incoming = val as Record<string, unknown>;
        if ("const" in existing && "const" in incoming) {
          mergedProperties[key] = {
            type: existing.type ?? "string",
            enum: [existing.const, incoming.const],
          };
        } else if ("enum" in existing && "const" in incoming) {
          const enumVals = [...(existing.enum as unknown[]), incoming.const];
          mergedProperties[key] = { type: existing.type ?? "string", enum: enumVals };
        }
      }
    }

    // Only require fields present in ALL variants
    const variantRequired = new Set((variant.required as string[]) ?? []);
    if (allRequired.size === 0) {
      for (const r of variantRequired) allRequired.add(r);
    } else {
      for (const r of allRequired) {
        if (!variantRequired.has(r)) allRequired.delete(r);
      }
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties: mergedProperties,
  };
  if (allRequired.size > 0) {
    result.required = [...allRequired];
  }
  return result;
}

export function patchAnthropicToolSchemas(): void {
  const proto = ChatAnthropicMessages.prototype;
  const original = proto.formatStructuredToolToAnthropic;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const patched = function (this: any, tools: any) {
    const formatted = original.call(this, tools) as any[] | undefined;
    if (!formatted) return formatted;

    for (const tool of formatted) {
      let schema = tool.input_schema;
      if (!schema || typeof schema !== "object") continue;

      // Fix top-level anyOf/oneOf (e.g. from z.discriminatedUnion)
      if ("anyOf" in schema || "oneOf" in schema) {
        getLogger().warn(
          { tool: tool.name },
          "Flattened top-level anyOf/oneOf in input_schema for Anthropic API",
        );
        schema = flattenTopLevelUnion(schema);
        tool.input_schema = schema;
      }

      // Fix missing or wrong type
      if (schema.type !== "object") {
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
