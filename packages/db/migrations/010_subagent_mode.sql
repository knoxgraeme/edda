-- 010_subagent_mode.sql
-- Add configurable subagent overrides to settings table.
-- When an agent is spawned via deepagents' built-in task tool (synchronous subagent),
-- these overrides strip down its capabilities (no nesting, no memory writes, no self-improvement).

ALTER TABLE settings
  ADD COLUMN subagent_overrides JSONB NOT NULL DEFAULT '{
    "blocked_tools": ["run_agent", "save_agents_md", "seed_agents_md", "create_agent", "delete_agent", "update_agent", "install_skill"],
    "blocked_skills": ["self_improvement", "self_reflect", "admin"],
    "memory_capture": false,
    "allow_nesting": false
  }';
