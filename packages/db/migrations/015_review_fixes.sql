-- Post-review fixes for migrations 009, 011–014.
--
-- Fix 1 (P1): Migration 009 only updated agents_md_token_budget WHERE = 2000,
-- which misses fresh installs that may have a different initial default.
-- Use < 4000 to catch all cases.
--
-- Note 2 (P2): Migrations 012 and 014 form a round-trip: 012 adds
-- self_reflection to the maintenance agent, 014 removes it. The net effect
-- is only the weekly_reflect prompt update in 014. This is harmless — both
-- migrations are idempotent and the final state is correct regardless of
-- whether they ran or not. No corrective action needed.
--
-- Note 3 (P2): Migration 013 updates session_summary's description,
-- metadata_schema, and classification_hint to the exact same values that
-- migration 011 already INSERTs. The UPDATE is a no-op on any install where
-- 011 ran first (which is always the case). This is redundant but harmless.

-- Fix 1: Ensure agents_md_token_budget is at least 4000 on all installs
UPDATE settings
SET agents_md_token_budget = 4000
WHERE agents_md_token_budget < 4000;
