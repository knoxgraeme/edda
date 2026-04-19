/**
 * LLM provider metadata for client components.
 *
 * The canonical list lives in @edda/db (LLM_PROVIDERS), but client components
 * can't import from @edda/db. This file provides display labels and the
 * validation set for use in dropdowns and forms.
 */

import type { LlmProvider } from "@/app/types/db";

export const LLM_PROVIDER_OPTIONS: {
  value: LlmProvider;
  label: string;
  envVar: string;
}[] = [
  { value: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  { value: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { value: "google", label: "Google", envVar: "GOOGLE_API_KEY" },
  { value: "groq", label: "Groq", envVar: "GROQ_API_KEY" },
  { value: "ollama", label: "Ollama", envVar: "OLLAMA_HOST" },
  { value: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY" },
  { value: "bedrock", label: "Bedrock", envVar: "AWS_ACCESS_KEY_ID" },
  { value: "xai", label: "xAI (Grok)", envVar: "XAI_API_KEY" },
  { value: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
  { value: "cerebras", label: "Cerebras", envVar: "CEREBRAS_API_KEY" },
  { value: "fireworks", label: "Fireworks", envVar: "FIREWORKS_API_KEY" },
  { value: "together", label: "Together", envVar: "TOGETHER_API_KEY" },
  { value: "azure_openai", label: "Azure OpenAI", envVar: "AZURE_OPENAI_API_KEY" },
  { value: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
  { value: "minimax", label: "Minimax", envVar: "MINIMAX_API_KEY" },
  { value: "moonshot", label: "Moonshot", envVar: "MOONSHOT_API_KEY" },
  { value: "zhipuai", label: "ZhipuAI (ChatGLM)", envVar: "ZHIPUAI_API_KEY" },
];

export const VALID_LLM_PROVIDERS = new Set<LlmProvider>(
  LLM_PROVIDER_OPTIONS.map((p) => p.value),
);

export function envVarForProvider(provider: LlmProvider): string {
  return LLM_PROVIDER_OPTIONS.find((p) => p.value === provider)?.envVar ?? "API_KEY";
}
