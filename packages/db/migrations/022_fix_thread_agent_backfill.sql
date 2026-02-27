-- Fix backfill from migration 020: the regex ^task-([^-]+) only captured the
-- first hyphen-delimited segment of the agent name.  For an agent called
-- "my-agent" with thread "task-my-agent-2026-02-26" it extracted "my" instead
-- of "my-agent".
--
-- Thread ID formats produced by resolveThreadId():
--   ephemeral:  task-{name}-{uuid}                       (UUID = 8-4-4-4-12 hex)
--   daily:      task-{name}-{YYYY-MM-DD}                 (date suffix)
--   daily+ch:   task-{name}-{YYYY-MM-DD}-{platform}:{id} (channel-scoped daily)
--   persistent: task-{name}                              (no suffix)
--   persistent+ch: task-{name}-{platform}:{id}           (channel-scoped persistent)
--
-- Strategy: strip known suffixes from the right to recover the agent name.
-- We handle them in order from most specific to least specific.

UPDATE thread_metadata
SET agent_name = CASE
  -- Ephemeral: ends with a UUID (8-4-4-4-12 hex pattern)
  WHEN thread_id ~ '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN regexp_replace(
      substring(thread_id FROM '^task-(.+)$'),
      '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      ''
    )
  -- Daily with channel suffix: ends with -YYYY-MM-DD-platform:id
  WHEN thread_id ~ '-\d{4}-\d{2}-\d{2}-.+:.+$'
    THEN regexp_replace(
      substring(thread_id FROM '^task-(.+)$'),
      '-\d{4}-\d{2}-\d{2}-.+:.+$',
      ''
    )
  -- Daily: ends with -YYYY-MM-DD
  WHEN thread_id ~ '-\d{4}-\d{2}-\d{2}$'
    THEN regexp_replace(
      substring(thread_id FROM '^task-(.+)$'),
      '-\d{4}-\d{2}-\d{2}$',
      ''
    )
  -- Persistent with channel suffix: contains platform:id (colon present)
  WHEN thread_id ~ '-[^-]+:.+$'
    THEN regexp_replace(
      substring(thread_id FROM '^task-(.+)$'),
      '-[^-]+:.+$',
      ''
    )
  -- Persistent: everything after task-
  ELSE substring(thread_id FROM '^task-(.+)$')
END
WHERE thread_id LIKE 'task-%';

-- Also make the digest item type inserts from 021 idempotent.
-- In environments where 021 already ran, these are no-ops.
-- In environments where 021 has not yet run, these ensure the types exist.
INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days)
VALUES (
  'daily_digest',
  '📰',
  'Daily summary of user activity, items captured, and notable events',
  '{"date": "ISO date the digest covers", "item_count": "number of items summarized", "highlights": "array of key highlights"}',
  'Agent-internal. Created automatically by the daily_digest skill during scheduled cron runs. Do NOT create manually or in response to user requests.',
  true,
  14
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days)
VALUES (
  'insight',
  '💡',
  'Weekly pattern or insight derived from analyzing user activity and behavior trends',
  '{"period": "time period covered", "category": "area of insight", "confidence": "how confident the observation is"}',
  'Agent-internal. Created automatically by the weekly_reflect skill during scheduled cron runs. Do NOT create manually or in response to user requests.',
  true,
  60
)
ON CONFLICT (name) DO NOTHING;
