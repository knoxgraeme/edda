-- Rename snake_case skill names to kebab-case in agents.skills arrays
UPDATE agents SET skills = array_replace(skills, 'agent_creation', 'agent-creation');
UPDATE agents SET skills = array_replace(skills, 'daily_digest', 'daily-digest');
UPDATE agents SET skills = array_replace(skills, 'memory_maintenance', 'memory-maintenance');
UPDATE agents SET skills = array_replace(skills, 'self_improvement', 'self-improvement');
UPDATE agents SET skills = array_replace(skills, 'self_reflect', 'self-reflect');
UPDATE agents SET skills = array_replace(skills, 'skill_management', 'skill-management');
UPDATE agents SET skills = array_replace(skills, 'type_evolution', 'type-evolution');
UPDATE agents SET skills = array_replace(skills, 'weekly_report', 'weekly-report');

-- Rename schedule names to match
UPDATE agent_schedules SET name = 'self-reflect' WHERE name = 'self_reflect';
UPDATE agent_schedules SET name = 'memory-maintenance' WHERE name = 'memory_maintenance';
UPDATE agent_schedules SET name = 'daily-digest' WHERE name = 'daily_digest';
UPDATE agent_schedules SET name = 'weekly-report' WHERE name = 'weekly_report';
UPDATE agent_schedules SET name = 'type-evolution' WHERE name = 'type_evolution';

-- Rename skill metadata rows
UPDATE skills SET name = 'agent-creation' WHERE name = 'agent_creation';
UPDATE skills SET name = 'daily-digest' WHERE name = 'daily_digest';
UPDATE skills SET name = 'memory-maintenance' WHERE name = 'memory_maintenance';
UPDATE skills SET name = 'self-improvement' WHERE name = 'self_improvement';
UPDATE skills SET name = 'self-reflect' WHERE name = 'self_reflect';
UPDATE skills SET name = 'skill-management' WHERE name = 'skill_management';
UPDATE skills SET name = 'type-evolution' WHERE name = 'type_evolution';
UPDATE skills SET name = 'weekly-report' WHERE name = 'weekly_report';
