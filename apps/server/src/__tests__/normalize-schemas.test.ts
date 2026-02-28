/**
 * Tests for Gemini JSON Schema normalization — const→enum, nullable types,
 * anyOf/oneOf flattening, discriminatedUnion merging, and Zod default preservation.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { normalizeToolForGemini, isGeminiModel } from "../agent/normalize-schemas.js";

/** Helper: create a minimal StructuredTool from a Zod schema for testing. */
function makeTool(name: string, schema: z.ZodObject<z.ZodRawShape>) {
  return new DynamicStructuredTool({
    name,
    description: `test tool: ${name}`,
    schema,
    func: async (input) => JSON.stringify(input),
  });
}

/** Helper: extract the normalized JSON Schema from a tool. */
function getNormalizedSchema(tool: ReturnType<typeof normalizeToolForGemini>) {
  // DynamicStructuredTool stores the schema; access it and convert if needed
  const s = tool.schema as Record<string, unknown>;
  // If it's a Zod schema, it has _def; if it's plain JSON Schema, it's an object
  if ("_def" in s || "_zod" in s) {
    throw new Error("Expected plain JSON Schema after normalization, got Zod");
  }
  return s;
}

describe("normalizeToolForGemini", () => {
  describe("const → enum", () => {
    it('converts { const: "value" } to { type: "string", enum: ["value"] }', () => {
      const tool = makeTool(
        "const_test",
        z.object({ action: z.literal("create") }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.action.type).toBe("string");
      expect(props.action.enum).toEqual(["create"]);
      expect(props.action).not.toHaveProperty("const");
    });
  });

  describe("nullable type array", () => {
    it('converts { type: ["string", "null"] } to { type: "string", nullable: true }', () => {
      const tool = makeTool(
        "nullable_test",
        z.object({ name: z.string().nullable() }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      const props = schema.properties as Record<string, Record<string, unknown>>;
      // The nullable field should have type "string" and nullable: true
      expect(props.name.nullable).toBe(true);
      expect(props.name.type).toBe("string");
      // Should not have an array type
      expect(Array.isArray(props.name.type)).toBe(false);
    });
  });

  describe("anyOf null union", () => {
    it("flattens anyOf with null variant to nullable", () => {
      const tool = makeTool(
        "anyof_null_test",
        z.object({ value: z.string().nullable() }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.value.nullable).toBe(true);
      expect(props.value.type).toBe("string");
      expect(props.value).not.toHaveProperty("anyOf");
    });
  });

  describe("anyOf with all-const variants", () => {
    it("flattens to enum when all variants are const of same type", () => {
      const tool = makeTool(
        "const_union_test",
        z.object({ status: z.enum(["active", "inactive", "archived"]) }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.status.type).toBe("string");
      expect(props.status.enum).toEqual(["active", "inactive", "archived"]);
    });
  });

  describe("mixed-type const returns null (unflattenable)", () => {
    it("does not flatten anyOf with mixed-type const values", () => {
      // Build a tool with a raw JSON Schema that has mixed-type anyOf consts
      // We can't easily create this with Zod, so we test via the tool wrapper
      // by using z.union with literals of different types
      const tool = makeTool(
        "mixed_const_test",
        z.object({ value: z.union([z.literal(1), z.literal("a")]) }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      const props = schema.properties as Record<string, Record<string, unknown>>;
      // Should keep anyOf since types are mixed (number + string)
      expect(props.value.anyOf ?? props.value.oneOf).toBeDefined();
    });
  });

  describe("discriminatedUnion flattening", () => {
    it("merges object variants with shared discriminator into single object with enum", () => {
      const tool = makeTool(
        "disc_union_test",
        z.object({
          action: z.discriminatedUnion("type", [
            z.object({
              type: z.literal("link"),
              agent_name: z.string(),
              platform: z.string(),
              external_id: z.string(),
            }),
            z.object({
              type: z.literal("unlink"),
              agent_name: z.string(),
              channel_id: z.string(),
            }),
            z.object({
              type: z.literal("update"),
              channel_id: z.string(),
              receive_messages: z.boolean().optional(),
            }),
          ]),
        }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      const props = schema.properties as Record<string, Record<string, unknown>>;
      const action = props.action;

      // Should be flattened to a single object
      expect(action.type).toBe("object");
      expect(action).not.toHaveProperty("anyOf");
      expect(action).not.toHaveProperty("oneOf");

      // Discriminator should be an enum
      const actionProps = action.properties as Record<string, Record<string, unknown>>;
      expect(actionProps.type.type).toBe("string");
      expect(actionProps.type.enum).toEqual(["link", "unlink", "update"]);

      // Required should include the discriminator
      expect(action.required).toContain("type");
    });
  });

  describe("nested recursive normalization", () => {
    it("normalizes nested nullable properties", () => {
      const tool = makeTool(
        "nested_test",
        z.object({
          outer: z.object({
            inner: z.string().nullable(),
          }),
        }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      const outerProps = (schema.properties as Record<string, Record<string, unknown>>).outer;
      const innerProps = (outerProps.properties as Record<string, Record<string, unknown>>).inner;
      expect(innerProps.nullable).toBe(true);
      expect(innerProps.type).toBe("string");
    });
  });

  describe("$schema and additionalProperties stripping", () => {
    it("removes $schema and additionalProperties from normalized output", () => {
      const tool = makeTool(
        "strip_test",
        z.object({ name: z.string() }),
      );
      const normalized = normalizeToolForGemini(tool);
      const schema = getNormalizedSchema(normalized);
      expect(schema).not.toHaveProperty("$schema");
      expect(schema).not.toHaveProperty("additionalProperties");
    });
  });

  describe("Zod defaults preservation", () => {
    it("restores Zod defaults when invoking the normalized tool", async () => {
      const tool = makeTool(
        "defaults_test",
        z.object({
          enabled: z.boolean().default(true),
          count: z.number().default(5),
          label: z.string().default("untitled"),
        }),
      );
      const normalized = normalizeToolForGemini(tool);
      // Invoke with empty input — defaults should be applied
      const result = await normalized.invoke({});
      const parsed = JSON.parse(result);
      expect(parsed.enabled).toBe(true);
      expect(parsed.count).toBe(5);
      expect(parsed.label).toBe("untitled");
    });
  });
});

describe("isGeminiModel", () => {
  it('returns true for "google-genai:" prefix', () => {
    expect(isGeminiModel("google-genai:gemini-2.0-flash")).toBe(true);
  });

  it('returns true for "google-vertexai:" prefix', () => {
    expect(isGeminiModel("google-vertexai:gemini-pro")).toBe(true);
  });

  it('returns false for "anthropic:" prefix', () => {
    expect(isGeminiModel("anthropic:claude-sonnet-4-20250514")).toBe(false);
  });

  it('returns false for "openai:" prefix', () => {
    expect(isGeminiModel("openai:gpt-4")).toBe(false);
  });
});
