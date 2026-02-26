-- Rename context_mode → thread_lifetime and update "isolated" → "ephemeral"
--
-- Safe: column rename + value update + constraint swap.
-- No data loss — pure rename.

-- agents table
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_context_mode_check;
ALTER TABLE agents RENAME COLUMN context_mode TO thread_lifetime;
UPDATE agents SET thread_lifetime = 'ephemeral' WHERE thread_lifetime = 'isolated';
ALTER TABLE agents ADD CONSTRAINT agents_thread_lifetime_check
  CHECK (thread_lifetime IN ('ephemeral', 'daily', 'persistent'));

-- agent_schedules table
ALTER TABLE agent_schedules DROP CONSTRAINT IF EXISTS agent_schedules_context_mode_check;
ALTER TABLE agent_schedules RENAME COLUMN context_mode TO thread_lifetime;
UPDATE agent_schedules SET thread_lifetime = 'ephemeral' WHERE thread_lifetime = 'isolated';
ALTER TABLE agent_schedules ADD CONSTRAINT agent_schedules_thread_lifetime_check
  CHECK (thread_lifetime IS NULL OR thread_lifetime IN ('ephemeral', 'daily', 'persistent'));
