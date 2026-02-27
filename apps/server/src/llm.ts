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
