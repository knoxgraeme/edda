-- MCP OAuth authentication support
-- Adds auth metadata to mcp_connections and a separate table for OAuth state

-- Auth metadata on mcp_connections
ALTER TABLE mcp_connections
  ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'none'
    CHECK (auth_type IN ('none', 'bearer', 'oauth')),
  ADD COLUMN auth_status TEXT NOT NULL DEFAULT 'active'
    CHECK (auth_status IN ('active', 'pending_auth', 'error'));

-- OAuth state (1:1 with mcp_connections that use OAuth)
CREATE TABLE mcp_oauth_state (
  connection_id UUID PRIMARY KEY REFERENCES mcp_connections(id) ON DELETE CASCADE,

  -- Client registration (encrypted JSON of OAuthClientInformationMixed)
  client_info_encrypted TEXT,

  -- Tokens (encrypted JSON of full SDK OAuthTokens object)
  tokens_encrypted TEXT,
  expires_at TIMESTAMPTZ,

  -- Discovery cache (SDK discovery state as JSONB)
  discovery_state JSONB,

  -- PKCE (temporary, cleared after token exchange)
  pending_auth JSONB,  -- { code_verifier_encrypted, state_param, redirect_uri }

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for callback lookup by state_param
CREATE UNIQUE INDEX idx_mcp_oauth_state_param
  ON mcp_oauth_state ((pending_auth->>'state_param'))
  WHERE pending_auth IS NOT NULL;
