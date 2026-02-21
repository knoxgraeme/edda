/**
 * Embedding factory — returns an Embeddings instance based on settings + env override
 *
 * Precedence: env EMBEDDING_PROVIDER → settings.embedding_provider → "voyage"
 *
 * The instance is cached as a singleton and invalidated when the
 * provider/model configuration changes.
 */

import type { Embeddings } from "@langchain/core/embeddings";
import { getSettingsSync } from "@edda/db";

let _cached: Embeddings | null = null;
let _cacheKey: string | null = null;

const EMBED_BATCH_SIZE = 96;

async function getCachedEmbeddings(): Promise<Embeddings> {
  const settings = getSettingsSync();
  const provider = process.env.EMBEDDING_PROVIDER || settings.embedding_provider || "voyage";
  const model = settings.embedding_model;
  const key = `${provider}:${model}`;

  if (_cached && _cacheKey === key) return _cached;

  _cached = await createEmbeddings(provider, model, settings.embedding_dimensions);
  _cacheKey = key;
  return _cached;
}

async function createEmbeddings(provider: string, model: string, dimensions: number): Promise<Embeddings> {
  switch (provider) {
    case "voyage": {
      const { VoyageEmbeddings } = await import("@langchain/community/embeddings/voyage");
      return new VoyageEmbeddings({ modelName: model });
    }
    case "openai": {
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      return new OpenAIEmbeddings({ model, dimensions });
    }
    case "google": {
      const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
      return new GoogleGenerativeAIEmbeddings({ model });
    }
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

export async function getEmbeddings(): Promise<Embeddings> {
  return getCachedEmbeddings();
}

/**
 * Embed a single text string, returning the vector.
 */
export async function embed(text: string): Promise<number[]> {
  const embeddings = await getCachedEmbeddings();
  const [vector] = await embeddings.embedDocuments([text]);
  return vector;
}

/**
 * Embed multiple texts, automatically chunking into batches of EMBED_BATCH_SIZE
 * to avoid provider rate limits and payload size errors.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embeddings = await getCachedEmbeddings();

  if (texts.length <= EMBED_BATCH_SIZE) {
    return embeddings.embedDocuments(texts);
  }

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const chunk = texts.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embeddings.embedDocuments(chunk);
    results.push(...vectors);
  }
  return results;
}
