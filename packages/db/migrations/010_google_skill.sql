-- Add google skill to edda's skills array
UPDATE agents
SET skills = array_append(skills, 'google')
WHERE name = 'edda'
  AND NOT ('google' = ANY(skills));
