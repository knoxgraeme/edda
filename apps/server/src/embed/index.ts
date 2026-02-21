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

function getCachedEmbeddings(): Embeddings {
  const settings = getSettingsSync();
  const provider = process.env.EMBEDDING_PROVIDER || settings.embedding_provider || "voyage";
  const model = settings.embedding_model;
  const key = `${provider}:${model}`;

  if (_cached && _cacheKey === key) return _cached;

  _cached = createEmbeddings(provider, model, settings.embedding_dimensions);
  _cacheKey = key;
  return _cached;
}

function createEmbeddings(provider: string, model: string, dimensions: number): Embeddings {
  switch (provider) {
    case "voyage": {
      const { VoyageEmbeddings } = require("@langchain/community/embeddings/voyage");
      return new VoyageEmbeddings({ modelName: model });
    }
    case "openai": {
      const { OpenAIEmbeddings } = require("@langchain/openai");
      return new OpenAIEmbeddings({ model, dimensions });
    }
    case "google": {
      const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
      return new GoogleGenerativeAIEmbeddings({ model });
    }
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

/** Keep getEmbeddings for backwards compatibility */
export function getEmbeddings(): Embeddings {
  return getCachedEmbeddings();
}

/**
 * Embed a single text string, returning the vector.
 */
export async function embed(text: string): Promise<number[]> {
  const embeddings = getCachedEmbeddings();
  const [vector] = await embeddings.embedDocuments([text]);
  return vector;
}

/**
 * Embed multiple texts in a single batch API call.
 * Much more efficient than calling embed() in a loop.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embeddings = getCachedEmbeddings();
  return embeddings.embedDocuments(texts);
}
