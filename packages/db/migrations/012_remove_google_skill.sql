-- Remove google skill from all agents
UPDATE agents
SET skills = array_remove(skills, 'google')
WHERE 'google' = ANY(skills);

-- Clean up skill metadata if present
DELETE FROM skills WHERE name = 'google';
