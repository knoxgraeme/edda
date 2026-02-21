/**
 * LLM factory — returns a BaseChatModel based on settings + env override
 *
 * Precedence: env LLM_PROVIDER → settings.llm_provider → "anthropic"
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getSettingsSync } from "@edda/db";

export function getChatModel(modelName?: string): BaseChatModel {
  const settings = getSettingsSync();
  const provider = process.env.LLM_PROVIDER || settings.llm_provider || "anthropic";
  const model = modelName || settings.default_model;

  switch (provider) {
    case "anthropic": {
      const { ChatAnthropic } = require("@langchain/anthropic");
      return new ChatAnthropic({ model });
    }
    case "openai": {
      const { ChatOpenAI } = require("@langchain/openai");
      return new ChatOpenAI({ model });
    }
    case "google": {
      const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ model });
    }
    case "groq": {
      const { ChatGroq } = require("@langchain/community/chat_models/groq");
      return new ChatGroq({ model });
    }
    case "ollama": {
      const { ChatOllama } = require("@langchain/community/chat_models/ollama");
      return new ChatOllama({
        model,
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      });
    }
    case "mistral": {
      const { ChatMistralAI } = require("@langchain/community/chat_models/mistral");
      return new ChatMistralAI({ model });
    }
    case "bedrock": {
      const { ChatBedrockConverse } = require("@langchain/community/chat_models/bedrock");
      return new ChatBedrockConverse({
        model,
        region: process.env.AWS_REGION || "us-east-1",
      });
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
