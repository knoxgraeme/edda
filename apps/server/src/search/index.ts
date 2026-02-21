/**
 * Search tool factory — returns a StructuredTool based on settings + env override
 *
 * Precedence: env SEARCH_PROVIDER → settings.search_provider → "tavily"
 * Returns null if web search is disabled.
 */

import { getSettingsSync } from "@edda/db";

export function getSearchTool(maxResults?: number): unknown | null {
  const settings = getSettingsSync();
  if (!settings.web_search_enabled) return null;

  const provider = process.env.SEARCH_PROVIDER || settings.search_provider || "tavily";
  const results = maxResults ?? settings.web_search_max_results;

  switch (provider) {
    case "tavily": {
      const { TavilySearchResults } = require("@langchain/community/tools/tavily_search");
      return new TavilySearchResults({ maxResults: results });
    }
    case "brave": {
      const { BraveSearch } = require("@langchain/community/tools/brave_search");
      return new BraveSearch({ apiKey: process.env.BRAVE_API_KEY });
    }
    case "serper": {
      const { Serper } = require("@langchain/community/tools/serper");
      return new Serper({ apiKey: process.env.SERPER_API_KEY });
    }
    case "serpapi": {
      const { SerpAPI } = require("@langchain/community/tools/serpapi");
      return new SerpAPI(process.env.SERPAPI_API_KEY);
    }
    default:
      throw new Error(`Unknown search provider: ${provider}`);
  }
}
