-- Allow NULL notify_expires_after to mean "no expiry"
ALTER TABLE agent_schedules ALTER COLUMN notify_expires_after DROP NOT NULL;
ALTER TABLE agent_schedules ALTER COLUMN notify_expires_after SET DEFAULT '72 hours';
