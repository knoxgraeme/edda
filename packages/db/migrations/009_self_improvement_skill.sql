-- System prompt & AGENTS.md redesign (Phase 1 + 2)
--
-- 1. Add self_improvement skill to the default edda agent.
--    The skill itself is seeded from disk by seed-skills.ts on startup.
-- 2. Increase AGENTS.md token budget from 2000 to 4000.
--    AGENTS.md is now procedural memory (communication, patterns, standards,
--    corrections) instead of a data mirror, so it needs more room for
--    synthesized operating notes.

UPDATE agents
SET skills = array_append(skills, 'self_improvement')
WHERE name = 'edda'
  AND NOT ('self_improvement' = ANY(skills));

UPDATE settings
SET agents_md_token_budget = 4000
WHERE agents_md_token_budget = 2000;
