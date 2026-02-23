-- Versioned AGENTS.md storage — each row is a complete version of the curated user context
CREATE TABLE IF NOT EXISTS agents_md_versions (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,                     -- the full curated AGENTS.md
  template TEXT NOT NULL DEFAULT '',         -- deterministic template used (for diffing next run)
  input_hash TEXT,                           -- SHA-256 of template inputs (change detection)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed with one empty row (initial version)
INSERT INTO agents_md_versions (content, template, input_hash)
SELECT '', '', NULL
WHERE NOT EXISTS (SELECT 1 FROM agents_md_versions);

-- Settings columns for the context_refresh cron
ALTER TABLE settings ADD COLUMN IF NOT EXISTS context_refresh_cron TEXT DEFAULT '0 5 * * *';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS context_refresh_model TEXT DEFAULT '';

-- Default context_refresh_model to same as memory_extraction_model
UPDATE settings SET context_refresh_model = memory_extraction_model WHERE context_refresh_model = '';
