-- Phase 3: Add session_summary item type for extraction retrospectives.
--
-- session_summary items capture what the agent learned about serving the user
-- from each processing pass: corrections received, preferences observed, and
-- quality signals. Created per extraction pass (not per session) — long-lived
-- threads get multiple summaries as new messages accumulate.
-- These feed the weekly_reflect skill's self-improvement analysis.

INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days)
VALUES (
  'session_summary',
  '🪞',
  'Extraction retrospective: what the agent learned about user preferences, corrections received, and quality signals from a processing pass',
  '{"thread_id": "UUID of the thread processed", "message_count": "number of messages covered in this pass", "corrections": "array of things user corrected", "preferences_observed": "array of new preferences noted", "quality_signals": "what went well or poorly"}',
  'Agent-internal. Created automatically by the memory_extraction skill after processing a batch of messages. Do NOT create manually or in response to user requests. Contains structured retrospective data — corrections and quality signals are the highest-value fields for self-improvement.',
  true,
  30
);
