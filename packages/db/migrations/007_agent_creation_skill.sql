-- Add agent_creation skill to edda's skills array
UPDATE agents
SET skills = array_append(skills, 'agent_creation')
WHERE name = 'edda'
  AND NOT ('agent_creation' = ANY(skills));
