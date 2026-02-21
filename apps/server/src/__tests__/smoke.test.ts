/**
 * Smoke tests — verify the server test infrastructure works.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createItemSchema } from "../agent/tools/create-item.js";
import { DEFAULT_TEST_SETTINGS, mockDbModule, mockEmbedModule } from "./helpers.js";

describe("test infrastructure", () => {
  it("imports a tool schema successfully", () => {
    expect(createItemSchema).toBeDefined();
    expect(createItemSchema instanceof z.ZodObject).toBe(true);
  });

  it("schema validates correct input", () => {
    const result = createItemSchema.safeParse({
      type: "note",
      content: "test content",
    });
    expect(result.success).toBe(true);
  });

  it("schema rejects missing required fields", () => {
    const result = createItemSchema.safeParse({
      type: "note",
      // missing content
    });
    expect(result.success).toBe(false);
  });

  it("DEFAULT_TEST_SETTINGS has required fields", () => {
    expect(DEFAULT_TEST_SETTINGS.llm_provider).toBe("anthropic");
    expect(DEFAULT_TEST_SETTINGS.embedding_dimensions).toBe(1536);
  });

  it("mockDbModule returns all expected exports", () => {
    const mocks = mockDbModule();
    expect(mocks.createItem).toBeDefined();
    expect(mocks.getSettingsSync).toBeDefined();
    expect(mocks.getSettingsSync()).toEqual(DEFAULT_TEST_SETTINGS);
  });

  it("mockEmbedModule returns correct dimensions", async () => {
    const mocks = mockEmbedModule();
    const embedding = await mocks.embed("test");
    expect(embedding).toHaveLength(1536);
  });
});
