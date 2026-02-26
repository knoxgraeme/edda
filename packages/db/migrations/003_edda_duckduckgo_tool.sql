-- Add duckduckgo to the default edda agent's tools
UPDATE agents
SET tools = array_append(tools, 'duckduckgo')
WHERE name = 'edda'
  AND NOT ('duckduckgo' = ANY(tools));
