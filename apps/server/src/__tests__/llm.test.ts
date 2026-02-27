/**
 * LLM factory tests — provider selection, model resolution, error handling.
 *
 * Tests cover the three main providers with proper package exports
 * (anthropic, openai, google). Community providers (groq, ollama, mistral,
 * bedrock) use @vite-ignore to skip static resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";

const { mockGetSettingsSync } = vi.hoisted(() => {
  return {
    mockGetSettingsSync: vi.fn(),
  };
});

vi.mock("@edda/db", () => ({
  getSettingsSync: mockGetSettingsSync,
}));

import { getChatModel } from "../llm.js";

describe("getChatModel", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
    process.env = { ...originalEnv };
    process.env.ANTHROPIC_API_KEY = "test-key-anthropic";
    process.env.OPENAI_API_KEY = "test-key-openai";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("selects provider from settings.llm_provider", async () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "anthropic",
    });
    const anthropicModel = await getChatModel();
    expect(anthropicModel.constructor.name).toMatch(/Anthropic/);

    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "openai",
    });
    const openaiModel = await getChatModel();
    expect(openaiModel.constructor.name).toMatch(/OpenAI/);
  });

  it("unknown provider throws", async () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "nonexistent",
    });
    await expect(getChatModel()).rejects.toThrow("Unknown LLM provider: nonexistent");
  });

  it("model name resolved from settings when not passed as argument", async () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      default_model: "claude-opus-4-20250514",
    });
    const model = await getChatModel();
    expect(model).toBeDefined();
    expect((model as Record<string, unknown>).model).toBe("claude-opus-4-20250514");
  });
});
