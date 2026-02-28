/**
 * Normalize JSON Schemas for Gemini API compatibility.
 *
 * Google Gemini rejects standard JSON Schema features it doesn't support:
 * - `const` keyword (from z.literal())
 * - `anyOf`/`oneOf` with `const` values (from z.discriminatedUnion())
 * - `type` as array `["string", "null"]` (from .nullable())
 *
 * LangChain's `@langchain/google-genai` only strips `additionalProperties`/
 * `$schema`/`strict` but does NOT handle these patterns.
 *
 * This module converts StructuredTool (Zod-based) tools into
 * DynamicStructuredTool with pre-normalized JSON Schema, bypassing
 * LangChain's incomplete conversion.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { StructuredTool } from "@langchain/core/tools";
import type { ZodObject } from "zod";

type JsonSchema = Record<string, unknown>;

export function isGeminiModel(modelString: string): boolean {
  return modelString.startsWith("google-genai:") || modelString.startsWith("google-vertexai:");
}

/**
 * Deep-normalize a JSON Schema for Gemini API compatibility.
 */
function normalizeJsonSchemaForGemini(schema: JsonSchema): JsonSchema {
  return normalizeNode(structuredClone(schema));
}

function normalizeNode(node: JsonSchema): JsonSchema {
  if (typeof node !== "object" || node === null) return node;

  // Remove unsupported top-level keywords
  delete node.$schema;
  delete node.additionalProperties;

  // Ensure top-level has type: "object" if it has properties
  if (node.properties && !node.type) {
    node.type = "object";
  }

  // 1. { const: "value" } → { type: "string", enum: ["value"] }
  if ("const" in node) {
    const val = node.const;
    delete node.const;
    node.type = typeof val === "number" ? "number" : typeof val === "boolean" ? "boolean" : "string";
    node.enum = [val];
    return node;
  }

  // 2. { type: ["string", "null"] } → { type: "string", nullable: true }
  if (Array.isArray(node.type)) {
    const types = node.type as string[];
    const nonNull = types.filter((t) => t !== "null");
    if (types.includes("null")) {
      node.nullable = true;
    }
    node.type = nonNull.length === 1 ? nonNull[0] : nonNull[0] ?? "string";
  }

  // 3. anyOf / oneOf normalization
  for (const keyword of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(node[keyword])) {
      const variants = node[keyword] as JsonSchema[];
      const normalized = tryFlattenUnion(variants);
      if (normalized) {
        delete node[keyword];
        for (const [k, v] of Object.entries(normalized)) {
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          node[k] = v;
        }
      } else {
        // Recursively normalize each variant
        node[keyword] = variants.map((v) => normalizeNode(v as JsonSchema));
      }
    }
  }

  // Recurse into properties
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, JsonSchema>)) {
      (node.properties as Record<string, JsonSchema>)[key] = normalizeNode(val);
    }
  }

  // Recurse into items (arrays)
  if (node.items && typeof node.items === "object") {
    node.items = normalizeNode(node.items as JsonSchema);
  }

  return node;
}

/**
 * Try to flatten a union into a simpler Gemini-compatible form.
 *
 * Handles:
 * - [{ type: X }, { type: "null" }] → { type: X, nullable: true }
 * - [{ const: "a" }, { const: "b" }] → { type: "string", enum: ["a", "b"] }
 * - [{ type: X, const: "a" }, { type: X, const: "b" }] → { type: X, enum: ["a", "b"] }
 *
 * Returns null if the union can't be flattened.
 */
function tryFlattenUnion(variants: JsonSchema[]): JsonSchema | null {
  if (variants.length === 0) return null;

  // Case: [{ type: X }, { type: "null" }] or [{ type: "null" }, { type: X }]
  if (variants.length === 2) {
    const nullIdx = variants.findIndex(
      (v) => v.type === "null" || (Array.isArray(v.type) && v.type.length === 1 && v.type[0] === "null"),
    );
    if (nullIdx !== -1) {
      const other = normalizeNode({ ...variants[1 - nullIdx] });
      other.nullable = true;
      return other;
    }
  }

  // Case: all variants have `const` → flatten to enum
  if (variants.every((v) => "const" in v)) {
    const values = variants.map((v) => v.const);
    const types = values.map((v) =>
      typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string",
    );
    const uniqueTypes = [...new Set(types)];
    if (uniqueTypes.length > 1) return null; // mixed-type enums are unflattenable
    return {
      type: uniqueTypes[0],
      enum: values,
    };
  }

  // Case: discriminatedUnion — all variants are objects sharing a common
  // discriminator field (each has a different const/enum value). Merge into
  // a single object: discriminator becomes enum, all other props optional.
  if (
    variants.length >= 2 &&
    variants.every(
      (v) => v.type === "object" || (v.properties && typeof v.properties === "object"),
    )
  ) {
    const propKeys = variants.map((v) =>
      Object.keys((v.properties as Record<string, JsonSchema>) ?? {}),
    );
    const commonKeys =
      propKeys[0]?.filter((k) => propKeys.every((keys) => keys.includes(k))) ?? [];

    for (const candidateKey of commonKeys) {
      const constValues: unknown[] = [];
      let isDiscriminator = true;

      for (const v of variants) {
        const prop = (v.properties as Record<string, JsonSchema>)[candidateKey];
        if ("const" in prop) {
          constValues.push(prop.const);
        } else if (Array.isArray(prop.enum) && prop.enum.length === 1) {
          constValues.push(prop.enum[0]);
        } else {
          isDiscriminator = false;
          break;
        }
      }

      if (!isDiscriminator) continue;
      if (new Set(constValues.map(String)).size !== variants.length) continue;

      // Merge all properties from all variants
      const mergedProperties: Record<string, JsonSchema> = {};
      for (const v of variants) {
        const props = (v.properties as Record<string, JsonSchema>) ?? {};
        for (const [key, val] of Object.entries(props)) {
          if (!(key in mergedProperties)) {
            mergedProperties[key] = normalizeNode(structuredClone(val));
          }
        }
      }

      // Replace discriminator field with enum of all values
      const discTypes = constValues.map((v) =>
        typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string",
      );
      const uniqueDiscTypes = [...new Set(discTypes)];
      mergedProperties[candidateKey] = {
        type: uniqueDiscTypes.length === 1 ? uniqueDiscTypes[0] : "string",
        enum: constValues,
      };

      return {
        type: "object",
        properties: mergedProperties,
        required: [candidateKey],
      };
    }
  }

  return null;
}

/**
 * Convert a StructuredTool (Zod-based) into a DynamicStructuredTool
 * with a pre-normalized JSON Schema that Gemini can accept.
 */
export function normalizeToolForGemini(tool: StructuredTool): StructuredTool {
  const schema = tool.schema;
  if (!schema || typeof schema !== "object") return tool;

  // Keep original Zod schema so we can restore defaults/transforms/refinements
  const isZod = "_def" in schema || "_zod" in schema;
  const originalZodSchema = isZod ? (schema as ZodObject<never>) : null;

  // Convert Zod schema to JSON Schema
  let jsonSchema: JsonSchema;
  if (isZod) {
    jsonSchema = zodToJsonSchema(originalZodSchema!, {
      $refStrategy: "none",
      target: "openApi3",
    }) as JsonSchema;
  } else {
    // Already a plain JSON Schema
    jsonSchema = schema as JsonSchema;
  }

  const normalized = normalizeJsonSchemaForGemini(jsonSchema);

  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: normalized as DynamicStructuredTool["schema"],
    func: async (input, runManager, config) => {
      // Re-parse through original Zod schema to restore defaults, transforms, and refinements
      // that were lost during JSON Schema conversion
      const parsed = originalZodSchema ? originalZodSchema.parse(input) : input;
      return tool.invoke(parsed, { ...config, callbacks: runManager?.getChild() });
    },
  });
}
