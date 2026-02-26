-- Notifications system — proper notification table with per-schedule config.
-- Replaces the stub notify() that wrote to the items table.

-- ════════════════════════════════════════════════════════════════
-- Notifications table
-- ════════════════════════════════════════════════════════════════

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type  TEXT NOT NULL CHECK (source_type IN ('schedule', 'agent', 'system')),
  source_id    TEXT NOT NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('inbox', 'agent')),
  target_id    TEXT,
  summary      TEXT NOT NULL,
  detail       JSONB NOT NULL DEFAULT '{}',
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status       TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed')),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_target ON notifications(target_type, target_id, status, expires_at);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- ════════════════════════════════════════════════════════════════
-- Per-schedule notification config on agent_schedules
-- ════════════════════════════════════════════════════════════════

ALTER TABLE agent_schedules
  ADD COLUMN notify TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN notify_expires_after INTERVAL NOT NULL DEFAULT '72 hours';

-- ════════════════════════════════════════════════════════════════
-- Seed notify values for built-in schedules
-- ════════════════════════════════════════════════════════════════

-- daily_digest & weekly_reflect: inbox + active trigger to edda
UPDATE agent_schedules
SET notify = '{inbox,agent:edda:active}', notify_expires_after = '24 hours'
WHERE name = 'daily_digest'
  AND agent_id = (SELECT id FROM agents WHERE name = 'digest');

UPDATE agent_schedules
SET notify = '{inbox,agent:edda:active}', notify_expires_after = '72 hours'
WHERE name = 'weekly_reflect'
  AND agent_id = (SELECT id FROM agents WHERE name = 'digest');

-- context_refresh, type_evolution, memory_catchup: silent (empty default is fine)
