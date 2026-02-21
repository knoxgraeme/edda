/**
 * LLM factory tests — provider selection, model resolution, error handling.
 *
 * The LLM factory uses require() for dynamic provider imports. In Vitest ESM,
 * vi.mock() does not intercept require() calls. We work around this by:
 * 1. Setting dummy API keys so real constructors don't throw on missing keys
 * 2. Inspecting the returned object's constructor/class to verify correct provider
 * 3. Using vi.resetModules() between tests for isolation
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

import { getChatModel } from "../llm/index.js";

describe("getChatModel", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER;
    // Provide dummy API keys so real constructors don't throw
    process.env.ANTHROPIC_API_KEY = "test-key-anthropic";
    process.env.OPENAI_API_KEY = "test-key-openai";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("selects provider: env LLM_PROVIDER > settings.llm_provider > default", () => {
    // Default: settings say "anthropic", no env override — should create Anthropic model
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "anthropic",
    });
    const anthropicModel = getChatModel();
    expect(anthropicModel.constructor.name).toMatch(/Anthropic/);

    // Env override takes precedence over settings
    process.env.LLM_PROVIDER = "openai";
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "anthropic", // settings say anthropic, but env says openai
    });
    const openaiModel = getChatModel();
    expect(openaiModel.constructor.name).toMatch(/OpenAI/);
  });

  it("unknown provider throws", () => {
    process.env.LLM_PROVIDER = "nonexistent";
    expect(() => getChatModel()).toThrow("Unknown LLM provider: nonexistent");
  });

  it("model name resolved from settings when not passed as argument", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      default_model: "claude-opus-4-20250514",
    });
    const model = getChatModel();
    // The model instance should have the model name from settings
    // LangChain stores it in various places; check the constructor was called with it
    expect(model).toBeDefined();
    // Verify the modelName was passed through — ChatAnthropic stores it as `model`
    expect((model as Record<string, unknown>).model).toBe("claude-opus-4-20250514");
  });
});
