-- Update session_summary item type for segment-based processing.
--
-- session_summary items are created per extraction pass, not per session.
-- Long-lived threads get multiple summaries as new messages accumulate.
-- Add thread_id and message_count to metadata schema for watermark tracking.

UPDATE item_types
SET
  description = 'Extraction retrospective: what the agent learned about user preferences, corrections received, and quality signals from a processing pass',
  metadata_schema = '{"thread_id": "UUID of the thread processed", "message_count": "number of messages covered in this pass", "corrections": "array of things user corrected", "preferences_observed": "array of new preferences noted", "quality_signals": "what went well or poorly"}',
  classification_hint = 'Agent-internal. Created automatically by the memory_extraction skill after processing a batch of messages. Do NOT create manually or in response to user requests. Contains structured retrospective data — corrections and quality signals are the highest-value fields for self-improvement.'
WHERE name = 'session_summary';
