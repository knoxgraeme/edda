-- Phase 1: Rename agent_definitions → agents + schema changes

BEGIN;

ALTER TABLE agent_definitions RENAME TO agents;

ALTER TABLE agents ADD COLUMN trigger TEXT;
ALTER TABLE agents ADD COLUMN tools TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN subagents TEXT[] NOT NULL DEFAULT '{}';

UPDATE agents SET trigger = 'schedule' WHERE schedule IS NOT NULL;
UPDATE agents SET trigger = 'post_conversation' WHERE name = 'post_process';
UPDATE agents SET trigger = 'on_demand' WHERE name = 'type_evolution';
UPDATE agents SET trigger = 'on_demand' WHERE trigger IS NULL;

ALTER TABLE agents ADD CONSTRAINT agents_trigger_check
  CHECK (trigger IN ('schedule', 'post_conversation', 'on_demand'));

ALTER TABLE agents DROP COLUMN IF EXISTS output_mode;
ALTER TABLE agents DROP COLUMN IF EXISTS built_in;

ALTER TRIGGER agent_definitions_updated_at ON agents RENAME TO agents_updated_at;

ALTER TABLE task_runs RENAME COLUMN agent_definition_id TO agent_id;
ALTER TABLE task_runs RENAME CONSTRAINT task_runs_agent_definition_id_fkey TO task_runs_agent_id_fkey;
ALTER INDEX IF EXISTS idx_task_runs_agent_def RENAME TO idx_task_runs_agent_id;

COMMIT;
