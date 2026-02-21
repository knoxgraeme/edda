-- Add missing columns to existing tables per spec

-- ============================================================
-- ITEMS: add embedding_model, superseded_by, completed_at, pending_action
-- ============================================================

ALTER TABLE items ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES items(id);
ALTER TABLE items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS pending_action TEXT;

-- ============================================================
-- ENTITIES: add confirmed, pending_action, metadata
-- ============================================================

ALTER TABLE entities ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT true;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS pending_action TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ============================================================
-- ENTITIES: expand type CHECK constraint to include 'tool' and 'concept'
-- Removes old constraint via dynamic SQL, then adds the expanded one.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'entities_type_check' AND table_name = 'entities'
  ) THEN
    EXECUTE format('ALTER TABLE entities %s %s', 'DROP', 'CONSTRAINT entities_type_check');
  END IF;
END
$$;

ALTER TABLE entities ADD CONSTRAINT entities_type_check
  CHECK (type IN ('person', 'project', 'company', 'topic', 'place', 'tool', 'concept'));

-- ============================================================
-- ITEM_ENTITIES: add relationship column
-- ============================================================

ALTER TABLE item_entities ADD COLUMN IF NOT EXISTS relationship TEXT DEFAULT 'mentioned';

-- ============================================================
-- ITEM_TYPES: add columns needed by dashboard function and spec
-- ============================================================

ALTER TABLE item_types ADD COLUMN IF NOT EXISTS extraction_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS dashboard_section TEXT NOT NULL DEFAULT 'captured';
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS dashboard_priority INT DEFAULT 50;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS completable BOOLEAN DEFAULT false;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS has_due_date BOOLEAN DEFAULT false;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS is_list BOOLEAN DEFAULT false;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS include_in_recall BOOLEAN DEFAULT true;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS private BOOLEAN DEFAULT false;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS agent_internal BOOLEAN DEFAULT false;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS built_in BOOLEAN DEFAULT true;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT true;
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS pending_action TEXT;

-- ============================================================
-- Seed correct flag values for the 13 built-in item types
-- ============================================================

-- Agent-internal types: hidden from dashboard, excluded from recall, private
UPDATE item_types SET
  agent_internal = true,
  include_in_recall = false,
  private = true,
  dashboard_section = 'hidden'
WHERE name IN ('preference', 'learned_fact', 'pattern');

-- Tasks: completable with due dates, high priority on dashboard
UPDATE item_types SET
  completable = true,
  has_due_date = true,
  dashboard_section = 'actionable',
  dashboard_priority = 10
WHERE name = 'task';

-- Reminders: completable with due dates
UPDATE item_types SET
  completable = true,
  has_due_date = true,
  dashboard_section = 'actionable',
  dashboard_priority = 20
WHERE name = 'reminder';

-- Events: have dates but not completable
UPDATE item_types SET
  has_due_date = true,
  dashboard_section = 'actionable',
  dashboard_priority = 30
WHERE name = 'event';

-- Meetings: captured section with priority
UPDATE item_types SET
  dashboard_section = 'captured',
  dashboard_priority = 25
WHERE name = 'meeting';

-- List items: list section
UPDATE item_types SET
  is_list = true,
  dashboard_section = 'lists'
WHERE name = 'list_item';

-- Journal: private
UPDATE item_types SET
  private = true
WHERE name = 'journal';

-- Mark all seed types as built-in
UPDATE item_types SET built_in = true
WHERE name IN ('note', 'reminder', 'task', 'event', 'list_item', 'link',
               'idea', 'decision', 'meeting', 'journal', 'preference',
               'learned_fact', 'pattern');
