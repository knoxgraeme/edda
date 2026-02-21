/**
 * Search tool factory — returns a StructuredTool based on settings + env override
 *
 * Precedence: env SEARCH_PROVIDER → settings.search_provider → "tavily"
 * Returns null if web search is disabled.
 */

import type { StructuredTool } from "@langchain/core/tools";
import { getSettingsSync } from "@edda/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lazyImport(specifier: string): Promise<any> {
  return import(/* @vite-ignore */ specifier);
}

export async function getSearchTool(maxResults?: number): Promise<StructuredTool | null> {
  const settings = getSettingsSync();
  if (!settings.web_search_enabled) return null;

  const provider = process.env.SEARCH_PROVIDER || settings.search_provider || "tavily";
  const results = maxResults ?? settings.web_search_max_results;

  switch (provider) {
    case "tavily": {
      const mod = await lazyImport("@langchain/community/tools/tavily_search");
      return new mod.TavilySearchResults({ maxResults: results });
    }
    case "brave": {
      const mod = await lazyImport("@langchain/community/tools/brave_search");
      return new mod.BraveSearch({ apiKey: process.env.BRAVE_API_KEY });
    }
    case "serper": {
      const mod = await lazyImport("@langchain/community/tools/serper");
      return new mod.Serper({ apiKey: process.env.SERPER_API_KEY });
    }
    case "serpapi": {
      const mod = await lazyImport("@langchain/community/tools/serpapi");
      return new mod.SerpAPI(process.env.SERPAPI_API_KEY);
    }
    default:
      throw new Error(`Unknown search provider: ${provider}`);
  }
}
