-- Add model_provider column to agents table and make model nullable.
-- Existing agents get NULL for both (inherit from settings).

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS model_provider TEXT
    CHECK (model_provider IS NULL OR model_provider IN (
      'anthropic', 'openai', 'google', 'groq', 'ollama', 'mistral', 'bedrock'
    ));

ALTER TABLE agents
  ALTER COLUMN model DROP NOT NULL;

ALTER TABLE agents
  ALTER COLUMN model DROP DEFAULT;

-- Clear hardcoded model values from seeded agents so they inherit from settings
UPDATE agents
  SET model = NULL
  WHERE name IN ('edda', 'digest', 'maintenance', 'memory')
    AND model IS NOT NULL;
