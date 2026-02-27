/**
 * Embed factory tests — singleton caching, cache invalidation, dimensions.
 *
 * Each test uses vi.resetModules() to clear the module-level singleton cache
 * in embed.ts, then re-imports the module fresh.
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
    // Reset module registry so embed.ts singleton cache is cleared
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importEmbed() {
    return import("../embed.js");
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

  it("embedBatch chunks >96 items into multiple calls", async () => {
    // Create 100 items — should be chunked into 96 + 4
    const items = Array.from({ length: 100 }, (_, i) => `text-${i}`);

    // Make embedDocuments return unique vectors per call so we can verify ordering
    let callCount = 0;
    mockEmbedDocuments.mockImplementation((texts: string[]) => {
      callCount++;
      return Promise.resolve(texts.map((_: string, j: number) => [callCount, j]));
    });

    const { embedBatch } = await importEmbed();
    const results = await embedBatch(items);

    expect(results).toHaveLength(100);
    // Should have been called twice: once with 96, once with 4
    expect(mockEmbedDocuments).toHaveBeenCalledTimes(2);
    expect(mockEmbedDocuments.mock.calls[0][0]).toHaveLength(96);
    expect(mockEmbedDocuments.mock.calls[1][0]).toHaveLength(4);
    // Verify ordering: first 96 from call 1, last 4 from call 2
    expect(results[0]).toEqual([1, 0]);
    expect(results[95]).toEqual([1, 95]);
    expect(results[96]).toEqual([2, 0]);
    expect(results[99]).toEqual([2, 3]);
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
