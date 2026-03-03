/**
 * LLM model-string resolver — returns a `provider:model` string for deepagents/LangChain.
 *
 * deepagents and LangChain's `initChatModel` accept model strings in the format
 * `provider:model` (e.g. "anthropic:claude-sonnet-4-20250514").
 *
 * Per-agent overrides come as separate provider + model fields.
 * The global default is built from `settings.llm_provider` + `settings.default_model`.
 * NULL in either agent field means "inherit from settings".
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatOpenRouter } from "@langchain/openrouter";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getSettingsSync, LLM_PROVIDERS } from "@edda/db";
import type { LlmProvider } from "@edda/db";

/**
 * Map Edda's DB provider names to LangChain `initChatModel` provider keys.
 * See: langchain/chat_models/universal — MODEL_PROVIDER_CONFIG
 */
const PROVIDER_MAP: Record<LlmProvider, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google-genai",
  groq: "groq",
  ollama: "ollama",
  mistral: "mistralai",
  bedrock: "bedrock",
  xai: "xai",
  deepseek: "deepseek",
  cerebras: "cerebras",
  fireworks: "fireworks",
  together: "together",
  azure_openai: "azure_openai",
  openrouter: "openrouter", // handled specially in resolveModel()
  minimax: "minimax", // handled specially in resolveModel()
  moonshot: "moonshot", // handled specially in resolveModel()
  zhipuai: "zhipuai", // handled specially in resolveModel()
};

/**
 * Return a `provider:model` string suitable for deepagents / initChatModel.
 *
 * Both params are nullable — NULL means inherit from global settings.
 */
export function getModelString(
  agentProvider?: LlmProvider | null,
  agentModel?: string | null,
): string {
  const settings = getSettingsSync();
  const provider = agentProvider || settings.llm_provider || "anthropic";
  const model = agentModel || settings.default_model;
  if (!LLM_PROVIDERS.includes(provider as LlmProvider)) {
    throw new Error(`Unknown LLM provider: '${provider}'. Valid providers: ${LLM_PROVIDERS.join(", ")}`);
  }
  const langchainProvider = PROVIDER_MAP[provider];
  return `${langchainProvider}:${model}`;
}

/**
 * Resolve a model string into a model instance or pass-through string.
 *
 * Providers not in LangChain's `initChatModel` registry require direct
 * instantiation of their chat model class. All other providers return the
 * `provider:model` string for initChatModel to resolve.
 */
export async function resolveModel(
  agentProvider?: LlmProvider | null,
  agentModel?: string | null,
): Promise<BaseChatModel | string> {
  const settings = getSettingsSync();
  const provider = agentProvider || settings.llm_provider || "anthropic";
  const model = agentModel || settings.default_model;

  switch (provider) {
    case "openrouter":
      return new ChatOpenRouter({ model });
    case "minimax": {
      if (!process.env.MINIMAX_API_KEY) {
        throw new Error("Minimax requires MINIMAX_API_KEY environment variable");
      }
      return new ChatOpenAI({
        model,
        apiKey: process.env.MINIMAX_API_KEY,
        configuration: { baseURL: "https://api.minimax.io/v1" },
      });
    }
    case "moonshot": {
      if (!process.env.MOONSHOT_API_KEY) {
        throw new Error("Moonshot requires MOONSHOT_API_KEY environment variable");
      }
      return new ChatOpenAI({
        model,
        apiKey: process.env.MOONSHOT_API_KEY,
        configuration: { baseURL: "https://api.moonshot.ai/v1" },
      });
    }
    case "zhipuai": {
      if (!process.env.ZHIPUAI_API_KEY) {
        throw new Error("ZhipuAI requires ZHIPUAI_API_KEY environment variable");
      }
      return new ChatOpenAI({
        model,
        apiKey: process.env.ZHIPUAI_API_KEY,
        configuration: { baseURL: "https://open.bigmodel.cn/api/paas/v4" },
      });
    }
    default: {
      const langchainProvider = PROVIDER_MAP[provider as LlmProvider];
      return `${langchainProvider}:${model}`;
    }
  }
}
