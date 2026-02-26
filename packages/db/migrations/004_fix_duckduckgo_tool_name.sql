-- Fix duckduckgo tool name to match LangChain's registered name
UPDATE agents
SET tools = array_replace(tools, 'duckduckgo', 'duckduckgo-search')
WHERE name = 'edda'
  AND 'duckduckgo' = ANY(tools);
