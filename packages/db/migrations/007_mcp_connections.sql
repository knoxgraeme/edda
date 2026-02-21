-- MCP tool connections

CREATE TABLE mcp_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  transport TEXT NOT NULL
    CHECK (transport IN ('stdio', 'sse', 'streamable-http')),
  config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
