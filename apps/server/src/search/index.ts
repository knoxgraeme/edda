/**
 * Search tool factory — returns a StructuredTool based on settings + env override.
 *
 * Precedence: env SEARCH_PROVIDER → settings.search_provider → "tavily"
 *
 * The tool is always returned with name "web_search" regardless of provider,
 * so agents can reference it consistently in their tools[] array.
 * Returns null only if the provider requires an API key that isn't set.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import type { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getSettingsSync } from "@edda/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lazyImport(specifier: string): Promise<any> {
  return import(/* @vite-ignore */ specifier);
}

/**
 * Wrap a search tool so errors are returned as text to the agent
 * instead of throwing and killing the turn.
 */
function wrapWithErrorHandling(inner: StructuredTool): StructuredTool {
  return new DynamicStructuredTool({
    name: "web_search",
    description: inner.description,
    schema: z.object({ input: z.string().describe("Search query") }),
    func: async ({ input }) => {
      try {
        return await inner.invoke(input);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Web search failed: ${msg}. Try rephrasing or try again shortly.`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// DuckDuckGo via HTML endpoint (no duck-duck-scrape)
// ---------------------------------------------------------------------------

interface DdgResult {
  title: string;
  link: string;
  snippet: string;
}

const DDG_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://duckduckgo.com/",
};

/**
 * Search DuckDuckGo via the HTML-only endpoint (html.duckduckgo.com/html/).
 * This endpoint is designed for simple clients and is far more tolerant
 * of automated requests than the JS endpoint that duck-duck-scrape uses.
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<DdgResult[]> {
  const params = new URLSearchParams({ q: query, kl: "wt-wt" });
  const response = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
    method: "GET",
    headers: DDG_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
  }

  const html = await response.text();

  // Parse result blocks from the HTML response
  const results: DdgResult[] = [];
  const resultRegex =
    /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const [, link, rawTitle, rawSnippet] = match;
    // Strip HTML tags and decode entities
    const clean = (s: string) =>
      s
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .trim();
    results.push({
      title: clean(rawTitle),
      link: decodeURIComponent(link.replace(/^\/\/duckduckgo.com\/l\/\?uddg=/, "").split("&")[0]),
      snippet: clean(rawSnippet),
    });
  }

  return results;
}

function buildDuckDuckGoTool(maxResults: number): StructuredTool {
  return new DynamicStructuredTool({
    name: "web_search",
    description:
      "A web search engine. Useful for finding current information about any topic. Input should be a search query.",
    schema: z.object({ input: z.string().describe("Search query") }),
    func: async ({ input }) => {
      try {
        const results = await searchDuckDuckGo(input, maxResults);
        if (results.length === 0) {
          return "No search results found. Try a different query.";
        }
        return JSON.stringify(results);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Web search failed: ${msg}. Try rephrasing or try again shortly.`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function getSearchTool(maxResults?: number): Promise<StructuredTool | null> {
  const settings = getSettingsSync();

  const provider =
    process.env.SEARCH_PROVIDER || settings.search_provider || "brave";
  const results = maxResults ?? settings.web_search_max_results;

  switch (provider) {
    case "tavily": {
      if (!process.env.TAVILY_API_KEY) return null;
      const mod = await lazyImport("@langchain/community/tools/tavily_search");
      const tool = new mod.TavilySearchResults({ maxResults: results });
      return wrapWithErrorHandling(tool);
    }
    case "brave": {
      if (!process.env.BRAVE_API_KEY) return null;
      const mod = await lazyImport("@langchain/community/tools/brave_search");
      const tool = new mod.BraveSearch({ apiKey: process.env.BRAVE_API_KEY });
      return wrapWithErrorHandling(tool);
    }
    case "serper": {
      if (!process.env.SERPER_API_KEY) return null;
      const mod = await lazyImport("@langchain/community/tools/serper");
      const tool = new mod.Serper({ apiKey: process.env.SERPER_API_KEY });
      return wrapWithErrorHandling(tool);
    }
    case "serpapi": {
      if (!process.env.SERPAPI_API_KEY) return null;
      const mod = await lazyImport("@langchain/community/tools/serpapi");
      const tool = new mod.SerpAPI(process.env.SERPAPI_API_KEY);
      return wrapWithErrorHandling(tool);
    }
    case "duckduckgo":
      return buildDuckDuckGoTool(results);
    default:
      throw new Error(`Unknown search provider: ${provider}`);
  }
}
