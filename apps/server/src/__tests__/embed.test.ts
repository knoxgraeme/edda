/**
 * Embed factory tests — singleton caching, cache invalidation, dimensions.
 *
 * Each test uses vi.resetModules() to clear the module-level singleton cache
 * in embed/index.ts, then re-imports the module fresh.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Settings } from "@edda/db";
import { DEFAULT_TEST_SETTINGS } from "./helpers.js";

// Stub embedding instance with an embedDocuments method
const mockEmbedDocuments = vi.fn().mockResolvedValue([[1, 2, 3]]);
const MockVoyageEmbeddings = vi.fn().mockImplementation(() => ({
  embedDocuments: mockEmbedDocuments,
}));
const MockOpenAIEmbeddings = vi.fn().mockImplementation(() => ({
  embedDocuments: mockEmbedDocuments,
}));

// Mock the LangChain provider modules at the top level so they persist across resets
vi.mock("@langchain/community/embeddings/voyage", () => ({
  VoyageEmbeddings: MockVoyageEmbeddings,
}));
vi.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: MockOpenAIEmbeddings,
}));

// We need to mock @edda/db, but since we use vi.resetModules() we must
// re-register the mock before each fresh import. We keep a mutable ref
// for getSettingsSync return value.
let settingsValue: Settings = { ...DEFAULT_TEST_SETTINGS };

vi.mock("@edda/db", () => ({
  getSettingsSync: () => settingsValue,
}));

describe("embed factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.EMBEDDING_PROVIDER;
    settingsValue = { ...DEFAULT_TEST_SETTINGS };
    // Reset module registry so embed/index.ts singleton cache is cleared
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importEmbed() {
    return import("../embed/index.js");
  }

  it("singleton caching — second call returns same instance", async () => {
    const { getEmbeddings } = await importEmbed();
    const first = await getEmbeddings();
    const second = await getEmbeddings();
    expect(first).toBe(second);
    // Constructor called only once
    expect(MockVoyageEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("cache invalidation when provider or model changes", async () => {
    const { getEmbeddings } = await importEmbed();

    // First call creates voyage instance
    await getEmbeddings();
    expect(MockVoyageEmbeddings).toHaveBeenCalledTimes(1);

    // Change provider in settings — cache key changes, new instance created
    settingsValue = { ...DEFAULT_TEST_SETTINGS, embedding_provider: "openai", embedding_model: "text-embedding-3-small" };
    await getEmbeddings();
    expect(MockOpenAIEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("correct embedding dimensions passed from settings", async () => {
    settingsValue = {
      ...DEFAULT_TEST_SETTINGS,
      embedding_provider: "openai",
      embedding_model: "text-embedding-3-small",
      embedding_dimensions: 512,
    };
    const { getEmbeddings } = await importEmbed();
    await getEmbeddings();
    expect(MockOpenAIEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 512 }),
    );
  });
});
