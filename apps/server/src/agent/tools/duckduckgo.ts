/**
 * Tool: duckduckgo-search — Web search via DuckDuckGo.
 *
 * Community tool from @langchain/community. Lazy-loaded so the agent
 * still starts if the package is missing.
 */

import type { StructuredTool } from "@langchain/core/tools";

let _promise: Promise<StructuredTool | null> | null = null;

export function loadDuckDuckGoTool(): Promise<StructuredTool | null> {
  if (_promise) return _promise;
  _promise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ "@langchain/community/tools/duckduckgo_search");
      return new mod.DuckDuckGoSearch({ maxResults: 5 });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
      ) {
        return null;
      }
      console.warn('[community-tools] Failed to load DuckDuckGoSearch:', err);
      return null;
    }
  })();
  return _promise;
}
