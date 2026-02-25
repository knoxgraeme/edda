-- 032_simplify_item_types.sql
-- Simplify item_types table: drop unused columns, merge extraction_hint into
-- classification_hint, remove dead get_daily_dashboard() stored function.
--
-- Drops 11 columns: extraction_hint, dashboard_section, dashboard_priority,
-- completable, has_due_date, is_list, include_in_recall, private, built_in,
-- is_user_created, created_by.
--
-- Keeps: name, icon, description, classification_hint, metadata_schema,
-- agent_internal, confirmed, pending_action, created_at.

-- ── 1. Drop the dead stored function ─────────────────────

DROP FUNCTION IF EXISTS get_daily_dashboard(DATE);

-- ── 2. Merge extraction_hint into classification_hint ────
-- For types that have a non-empty extraction_hint, append it as a
-- "Metadata:" line at the end of classification_hint.

UPDATE item_types
SET classification_hint = classification_hint || ' Metadata: ' || extraction_hint
WHERE extraction_hint IS NOT NULL AND extraction_hint != '';

-- ── 3. Drop columns ─────────────────────────────────────

ALTER TABLE item_types DROP COLUMN IF EXISTS extraction_hint;
ALTER TABLE item_types DROP COLUMN IF EXISTS dashboard_section;
ALTER TABLE item_types DROP COLUMN IF EXISTS dashboard_priority;
ALTER TABLE item_types DROP COLUMN IF EXISTS completable;
ALTER TABLE item_types DROP COLUMN IF EXISTS has_due_date;
ALTER TABLE item_types DROP COLUMN IF EXISTS is_list;
ALTER TABLE item_types DROP COLUMN IF EXISTS include_in_recall;
ALTER TABLE item_types DROP COLUMN IF EXISTS private;
ALTER TABLE item_types DROP COLUMN IF EXISTS built_in;
ALTER TABLE item_types DROP COLUMN IF EXISTS is_user_created;
ALTER TABLE item_types DROP COLUMN IF EXISTS created_by;
