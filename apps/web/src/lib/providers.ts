/**
 * LLM provider metadata for client components.
 *
 * The canonical list lives in @edda/db (LLM_PROVIDERS), but client components
 * can't import from @edda/db. This file provides display labels and the
 * validation set for use in dropdowns and forms.
 */

import type { LlmProvider } from "@/app/types/db";

export const LLM_PROVIDER_OPTIONS: { value: LlmProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
  { value: "groq", label: "Groq" },
  { value: "ollama", label: "Ollama" },
  { value: "mistral", label: "Mistral" },
  { value: "bedrock", label: "Bedrock" },
  { value: "xai", label: "xAI (Grok)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "cerebras", label: "Cerebras" },
  { value: "fireworks", label: "Fireworks" },
  { value: "together", label: "Together" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
];

export const VALID_LLM_PROVIDERS = new Set<LlmProvider>(
  LLM_PROVIDER_OPTIONS.map((p) => p.value),
);
