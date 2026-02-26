-- Agent channels — platform-agnostic channel links for bidirectional chat
-- and proactive announcement delivery.
--
-- Each row links an agent to a specific platform channel (e.g. a Telegram
-- forum topic, Slack channel, Discord channel). Inbound messages on enabled
-- channels are routed to the linked agent. Channels with receive_announcements
-- also get proactive output from triggered runs and announce targets.

-- ════════════════════════════════════════════════════════════════
-- agent_channels table
-- ════════════════════════════════════════════════════════════════

CREATE TABLE agent_channels (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id                UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  platform                TEXT NOT NULL,
  external_id             TEXT NOT NULL,
  config                  JSONB NOT NULL DEFAULT '{}',
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  receive_announcements   BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE INDEX idx_agent_channels_agent ON agent_channels(agent_id);
CREATE INDEX idx_agent_channels_lookup ON agent_channels(platform, external_id) WHERE enabled;

-- ════════════════════════════════════════════════════════════════
-- thread_scope column on agents
-- ════════════════════════════════════════════════════════════════

ALTER TABLE agents ADD COLUMN thread_scope TEXT NOT NULL DEFAULT 'shared'
  CHECK (thread_scope IN ('shared', 'per_channel'));
