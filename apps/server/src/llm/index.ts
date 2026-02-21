/**
 * LLM factory — returns a BaseChatModel based on settings + env override
 *
 * Precedence: env LLM_PROVIDER → settings.llm_provider → "anthropic"
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getSettingsSync } from "@edda/db";

/**
 * Dynamically import a module by path. The indirection prevents Vite/Vitest
 * from statically analyzing and resolving the import specifier at build time,
 * which is needed for optional community provider packages that may not have
 * valid package.json exports entries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lazyImport(specifier: string): Promise<any> {
  return import(/* @vite-ignore */ specifier);
}

export async function getChatModel(modelName?: string): Promise<BaseChatModel> {
  const settings = getSettingsSync();
  const provider = process.env.LLM_PROVIDER || settings.llm_provider || "anthropic";
  const model = modelName || settings.default_model;

  switch (provider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model });
    }
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ model });
    }
    case "google": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ model });
    }
    case "groq": {
      const mod = await lazyImport("@langchain/community/chat_models/groq");
      return new mod.ChatGroq({ model });
    }
    case "ollama": {
      const mod = await lazyImport("@langchain/community/chat_models/ollama");
      return new mod.ChatOllama({
        model,
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      });
    }
    case "mistral": {
      const mod = await lazyImport("@langchain/community/chat_models/mistral");
      return new mod.ChatMistralAI({ model });
    }
    case "bedrock": {
      const mod = await lazyImport("@langchain/community/chat_models/bedrock");
      return new mod.ChatBedrockConverse({
        model,
        region: process.env.AWS_REGION || "us-east-1",
      });
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
