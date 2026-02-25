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
UPDATE agents SET metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{stores}',
  '{"*": "read"}'::jsonb
) WHERE name = 'edda';
