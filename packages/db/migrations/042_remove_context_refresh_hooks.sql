-- 042: Clear hooks from context_refresh schedule
--
-- Hooks are no longer used by the cron runner. The context_refresh agent
-- now uses get_context_diff + save_agents_md tools instead.

UPDATE agent_schedules
SET hooks = '{}'::jsonb
WHERE name = 'context_refresh';
