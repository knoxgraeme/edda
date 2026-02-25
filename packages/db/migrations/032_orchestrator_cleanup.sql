-- 032: Orchestrator cleanup
--
-- 1. Rename post_process → memory_writer (subagent, not independently triggered)
-- 2. Drop unused scopes/scope_mode columns from agents
-- 3. Add metadata hooks to context_refresh for cron runner

-- Rename post_process agent to memory_writer
UPDATE agents
SET name = 'memory_writer',
    description = 'Extract and persist memories and entities from conversations',
    trigger = NULL
WHERE name = 'post_process';

-- Drop unused scope columns (never wired up in search layer)
ALTER TABLE agents DROP COLUMN IF EXISTS scopes;
ALTER TABLE agents DROP COLUMN IF EXISTS scope_mode;

-- Add invocation hooks to context_refresh metadata
UPDATE agents SET metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{hooks}',
  '{"pre_invoke": "prepareContextRefreshInput", "post_invoke": "finalizeContextRefresh"}'::jsonb
) WHERE name = 'context_refresh';
