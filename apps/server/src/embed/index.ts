/**
 * Embedding factory — returns an Embeddings instance based on settings + env override
 *
 * Precedence: env EMBEDDING_PROVIDER → settings.embedding_provider → "voyage"
 */

import type { Embeddings } from "@langchain/core/embeddings";
import { getSettingsSync } from "@edda/db";

export function getEmbeddings(): Embeddings {
  const settings = getSettingsSync();
  const provider = process.env.EMBEDDING_PROVIDER || settings.embedding_provider || "voyage";
  const model = settings.embedding_model;
  const dimensions = settings.embedding_dimensions;

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

/**
 * Embed a single text string, returning the vector.
 */
export async function embed(text: string): Promise<number[]> {
  const embeddings = getEmbeddings();
  const [vector] = await embeddings.embedDocuments([text]);
  return vector;
}
