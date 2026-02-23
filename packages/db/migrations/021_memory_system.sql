-- Memory types registry (evolves over time as user data grows)
CREATE TABLE IF NOT EXISTS memory_types (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  entity_types TEXT[] NOT NULL,
  activity_threshold INT NOT NULL DEFAULT 10,
  stale_days INT NOT NULL DEFAULT 90,
  synthesis_style TEXT NOT NULL DEFAULT 'brief',
  split_threshold INT NOT NULL DEFAULT 5000,
  built_in BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed starting memory types
INSERT INTO memory_types (name, description, entity_types)
VALUES
  ('people',        'Synthesized briefs for person entities',  '{person}'),
  ('projects',      'Synthesized briefs for project entities', '{project}'),
  ('organizations', 'Synthesized briefs for company entities', '{company}')
ON CONFLICT (name) DO NOTHING;

-- Settings for memory sync cron
ALTER TABLE settings ADD COLUMN IF NOT EXISTS memory_sync_cron TEXT DEFAULT '0 6 * * 0';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS memory_sync_model TEXT DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS memory_file_activity_threshold INT DEFAULT 10;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS memory_file_stale_days INT DEFAULT 90;
