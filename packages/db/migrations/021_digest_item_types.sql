-- Add missing item types used by the digest agent's skills.
--
-- daily_digest: created by the daily_digest skill (daily summary of activity)
-- insight: created by the weekly_reflect skill (weekly pattern analysis)

INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days)
VALUES (
  'daily_digest',
  '📰',
  'Daily summary of user activity, items captured, and notable events',
  '{"date": "ISO date the digest covers", "item_count": "number of items summarized", "highlights": "array of key highlights"}',
  'Agent-internal. Created automatically by the daily_digest skill during scheduled cron runs. Do NOT create manually or in response to user requests.',
  true,
  14
);

INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days)
VALUES (
  'insight',
  '💡',
  'Weekly pattern or insight derived from analyzing user activity and behavior trends',
  '{"period": "time period covered", "category": "area of insight", "confidence": "how confident the observation is"}',
  'Agent-internal. Created automatically by the weekly_reflect skill during scheduled cron runs. Do NOT create manually or in response to user requests.',
  true,
  60
);
