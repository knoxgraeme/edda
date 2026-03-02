-- 008: Add new LLM providers (xai, deepseek, cerebras, fireworks, together, azure_openai, openrouter)
--
-- PostgreSQL CHECK constraints cannot be extended in-place; must drop + re-add.
-- This is safe: the new constraint is strictly a superset of the old one.

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_llm_provider_check;
ALTER TABLE settings ADD CONSTRAINT settings_llm_provider_check
  CHECK (llm_provider IN ('anthropic','openai','google','groq','ollama','mistral','bedrock',
    'xai','deepseek','cerebras','fireworks','together','azure_openai','openrouter'));

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_model_provider_check;
ALTER TABLE agents ADD CONSTRAINT agents_model_provider_check
  CHECK (model_provider IS NULL OR model_provider IN ('anthropic','openai','google','groq','ollama','mistral','bedrock',
    'xai','deepseek','cerebras','fireworks','together','azure_openai','openrouter'));
