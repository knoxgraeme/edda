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

const { mockGetSettingsSync, DEFAULT_SETTINGS } = vi.hoisted(() => {
  const DEFAULT_SETTINGS = {
    id: true,
    llm_provider: "anthropic",
    default_model: "claude-sonnet-4-20250514",
    embedding_provider: "voyage",
    embedding_model: "voyage-3",
    embedding_dimensions: 1536,
    search_provider: "tavily",
    web_search_enabled: false,
    web_search_max_results: 5,
    checkpointer_backend: "memory",
    memory_extraction_enabled: true,
    memory_extraction_cron: "0 2 * * *",
    memory_extraction_model: "claude-sonnet-4-20250514",
    memory_reinforce_threshold: 0.95,
    memory_update_threshold: 0.85,
    entity_exact_threshold: 0.95,
    entity_fuzzy_threshold: 0.8,
    agents_md_token_budget: 1500,
    agents_md_max_per_category: 10,
    agents_md_max_versions: 3,
    agents_md_max_entities: 10,
    tool_call_limit_global: 30,
    tool_call_limit_delete: 10,
    tool_call_limit_archive: 15,
    user_crons_enabled: false,
    user_cron_check_interval: "*/5 * * * *",
    user_cron_model: "claude-sonnet-4-20250514",
    cron_runner: "standalone",
    langgraph_platform_url: null,
    approval_new_type: "confirm",
    approval_archive_stale: "confirm",
    approval_merge_entity: "confirm",
    system_prompt_override: null,
    setup_completed: false,
    user_display_name: null,
    user_timezone: "America/New_York",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    mockGetSettingsSync: vi.fn(() => DEFAULT_SETTINGS),
    DEFAULT_SETTINGS,
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
      ...DEFAULT_SETTINGS,
      llm_provider: "anthropic",
    });
    const anthropicModel = getChatModel();
    expect(anthropicModel.constructor.name).toMatch(/Anthropic/);

    // Env override takes precedence over settings
    process.env.LLM_PROVIDER = "openai";
    mockGetSettingsSync.mockReturnValue({
      ...DEFAULT_SETTINGS,
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
      ...DEFAULT_SETTINGS,
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
