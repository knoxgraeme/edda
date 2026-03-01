-- Migration 004: Enable sandbox by default
--
-- Sets sandbox_provider to 'node-vfs' and adds the 'coding' skill
-- to the default edda agent so the execute tool is available.

-- 1. Default sandbox provider to node-vfs
ALTER TABLE settings ALTER COLUMN sandbox_provider SET DEFAULT 'node-vfs';
UPDATE settings SET sandbox_provider = 'node-vfs' WHERE sandbox_provider = 'none';

-- 2. Add coding skill to edda agent (idempotent — only if not already present)
UPDATE agents
SET skills = array_append(skills, 'coding')
WHERE name = 'edda'
  AND NOT ('coding' = ANY(skills));
