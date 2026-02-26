-- Add duckduckgo as a search provider and make web_search agent-scoped.

-- 1. Widen search_provider CHECK to include duckduckgo (safe: adding a value)
ALTER TABLE settings
  DROP CONSTRAINT settings_search_provider_check,
  ADD CONSTRAINT settings_search_provider_check
    CHECK (search_provider IN ('tavily', 'brave', 'serper', 'serpapi', 'duckduckgo'));

-- 2. Add web_search to edda's tools, remove stale duckduckgo-search
UPDATE agents
SET tools = array_remove(array_append(tools, 'web_search'), 'duckduckgo-search')
WHERE name = 'edda'
  AND NOT ('web_search' = ANY(tools));
