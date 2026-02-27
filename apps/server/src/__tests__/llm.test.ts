/**
 * LLM model-string resolver tests — provider mapping, format handling, defaults.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";

const { mockGetSettingsSync } = vi.hoisted(() => {
  return {
    mockGetSettingsSync: vi.fn(),
  };
});

vi.mock("@edda/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@edda/db")>();
  return {
    ...actual,
    getSettingsSync: mockGetSettingsSync,
  };
});

import { getModelString } from "../llm.js";

describe("getModelString", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_TEST_SETTINGS);
  });

  it("builds provider:model from DB settings when no overrides given", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "anthropic",
      default_model: "claude-sonnet-4-20250514",
    });
    expect(getModelString()).toBe("anthropic:claude-sonnet-4-20250514");
  });

  it("maps Edda 'google' provider to LangChain 'google-genai'", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "google",
      default_model: "gemini-2.0-flash",
    });
    expect(getModelString()).toBe("google-genai:gemini-2.0-flash");
  });

  it("maps Edda 'mistral' provider to LangChain 'mistralai'", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "mistral",
      default_model: "mistral-large-latest",
    });
    expect(getModelString()).toBe("mistralai:mistral-large-latest");
  });

  it("uses agent provider + model overrides", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "anthropic",
      default_model: "claude-sonnet-4-20250514",
    });
    expect(getModelString("google", "gemini-2.0-flash")).toBe(
      "google-genai:gemini-2.0-flash",
    );
  });

  it("agent provider override with default model", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "anthropic",
      default_model: "claude-sonnet-4-20250514",
    });
    // Override provider but keep default model
    expect(getModelString("openai", null)).toBe("openai:claude-sonnet-4-20250514");
  });

  it("agent model override with default provider", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "anthropic",
      default_model: "claude-sonnet-4-20250514",
    });
    // Override model but keep default provider
    expect(getModelString(null, "claude-haiku-4-5-20251001")).toBe(
      "anthropic:claude-haiku-4-5-20251001",
    );
  });

  it("defaults to anthropic when no llm_provider in settings", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: undefined,
      default_model: "claude-sonnet-4-20250514",
    });
    expect(getModelString()).toBe("anthropic:claude-sonnet-4-20250514");
  });

  it("throws for unknown provider", () => {
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_TEST_SETTINGS,
      llm_provider: "unknown-provider",
      default_model: "some-model",
    });
    expect(() => getModelString()).toThrow(/Unknown LLM provider/);
  });
});
