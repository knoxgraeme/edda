-- Seed retrieval context for memory_catchup: 30% boost for its own past extractions
UPDATE agents
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{retrieval_context}',
  '{"authorship_mode": "boost", "authorship_boost": 1.3}'::jsonb
)
WHERE name = 'memory_catchup';
