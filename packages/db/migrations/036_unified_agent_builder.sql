-- 036: MCP discovery cache + default agent setting
--
-- 1. Cache discovered tool names on MCP connections
-- 2. Add default_agent setting so the server can load any agent as primary
-- 3. Give edda agent wildcard store read access

-- 1. MCP tool discovery cache
ALTER TABLE mcp_connections ADD COLUMN discovered_tools text[] NOT NULL DEFAULT '{}';

-- 2. Default agent setting
ALTER TABLE settings ADD COLUMN default_agent text NOT NULL DEFAULT 'edda';

-- 3. Default agent store access (wildcard = read all agents' stores)
--    Uses INSERT ... ON CONFLICT to create the edda agent if it doesn't exist,
--    or update its metadata.stores if the key is not already set.
INSERT INTO agents (name, description, skills, trigger, context_mode, enabled, metadata)
VALUES ('edda', 'Primary orchestrator agent', '{}', 'on_demand', 'persistent', true,
        '{"stores": {"*": "read"}}'::jsonb)
ON CONFLICT (name) DO UPDATE SET metadata = jsonb_set(
  COALESCE(agents.metadata, '{}'), '{stores}',
  '{"*": "read"}'::jsonb
)
WHERE NOT (COALESCE(agents.metadata, '{}') ? 'stores');
