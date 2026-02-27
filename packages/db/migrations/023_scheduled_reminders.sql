-- Scheduled reminders: extend notifications table for future-scheduled delivery.
--
-- New statuses: 'scheduled' (waiting), 'sending' (claimed by poller), 'sent' (one-shot done).
-- New columns: scheduled_at, recurrence, targets.
--
-- NOTE: The inline CHECK on status must be replaced to allow the new values.
-- This is a safe widening — all existing values remain valid.

-- Replace the inline status CHECK with one that includes reminder statuses.
-- Find and drop the auto-named constraint, then add the widened one.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
  WHERE c.conrelid = 'notifications'::regclass
    AND c.contype = 'c'
    AND a.attname = 'status';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('unread', 'read', 'dismissed', 'scheduled', 'sending', 'sent'));

-- New columns for scheduled delivery
ALTER TABLE notifications ADD COLUMN scheduled_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN recurrence TEXT;
ALTER TABLE notifications ADD COLUMN targets TEXT[] NOT NULL DEFAULT '{}';

-- Partial index for the poller query (only scheduled rows)
CREATE INDEX idx_notifications_scheduled
  ON notifications (scheduled_at) WHERE status = 'scheduled';
