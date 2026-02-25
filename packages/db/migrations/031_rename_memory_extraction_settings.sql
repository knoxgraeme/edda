-- Rename memory_extraction_* settings columns to match the memory_catchup agent name
ALTER TABLE settings RENAME COLUMN memory_extraction_cron TO memory_catchup_cron;
ALTER TABLE settings RENAME COLUMN memory_extraction_model TO memory_catchup_model;
