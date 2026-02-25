-- 038_per_type_decay.sql
-- Add per-type temporal decay half-life. NULL = global default (30 days). 0 = no decay (evergreen).

ALTER TABLE item_types ADD COLUMN IF NOT EXISTS decay_half_life_days INTEGER;

-- Seed sensible defaults per type
UPDATE item_types SET decay_half_life_days = 0   WHERE name = 'learned_fact';   -- evergreen
UPDATE item_types SET decay_half_life_days = 180 WHERE name = 'preference';     -- drift slowly
UPDATE item_types SET decay_half_life_days = 90  WHERE name = 'pattern';        -- needs revalidation
UPDATE item_types SET decay_half_life_days = 14  WHERE name = 'task';           -- stale fast
UPDATE item_types SET decay_half_life_days = 7   WHERE name = 'reminder';       -- past-due = noise
UPDATE item_types SET decay_half_life_days = 30  WHERE name = 'note';           -- current default
UPDATE item_types SET decay_half_life_days = 30  WHERE name = 'list_item';      -- moderate
UPDATE item_types SET decay_half_life_days = 30  WHERE name = 'event';          -- moderate
UPDATE item_types SET decay_half_life_days = 60  WHERE name = 'meeting';        -- slower
UPDATE item_types SET decay_half_life_days = 60  WHERE name = 'idea';           -- slower
UPDATE item_types SET decay_half_life_days = 90  WHERE name = 'decision';       -- durable
UPDATE item_types SET decay_half_life_days = 60  WHERE name = 'journal';        -- slower
UPDATE item_types SET decay_half_life_days = 60  WHERE name = 'link';           -- slower
UPDATE item_types SET decay_half_life_days = 90  WHERE name = 'recommendation'; -- durable
UPDATE item_types SET decay_half_life_days = 7   WHERE name = 'notification';   -- ephemeral
