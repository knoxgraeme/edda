-- 011: Add Chinese LLM providers (minimax, moonshot, zhipuai)
--
-- Extends the provider CHECK constraints to include new providers.
-- Same pattern as 008_new_providers.sql — strictly a superset of the old constraint.

-- settings.llm_provider: replace constraint with expanded list
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_llm_provider_check;
ALTER TABLE settings ADD CONSTRAINT settings_llm_provider_check
  CHECK (llm_provider IN ('anthropic','openai','google','groq','ollama','mistral','bedrock',
    'xai','deepseek','cerebras','fireworks','together','azure_openai','openrouter',
    'minimax','moonshot','zhipuai'));

-- agents.model_provider: replace constraint with expanded list
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_model_provider_check;
ALTER TABLE agents ADD CONSTRAINT agents_model_provider_check
  CHECK (model_provider IS NULL OR model_provider IN ('anthropic','openai','google','groq','ollama','mistral','bedrock',
    'xai','deepseek','cerebras','fireworks','together','azure_openai','openrouter',
    'minimax','moonshot','zhipuai'));
