/**
 * Tool: wolfram_alpha — Computational knowledge via WolframAlpha.
 *
 * Community tool from @langchain/community. Requires WOLFRAM_APP_ID env var.
 * Lazy-loaded so the agent still starts if the package is missing or
 * the env var is unset.
 */

import type { StructuredTool } from "@langchain/core/tools";

let _promise: Promise<StructuredTool | null> | null = null;

export function loadWolframAlphaTool(): Promise<StructuredTool | null> {
  const appId = process.env.WOLFRAM_APP_ID;
  if (!appId) return Promise.resolve(null);
  if (_promise) return _promise;
  _promise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ "@langchain/community/tools/wolframalpha");
      return new mod.WolframAlphaTool({ appid: appId });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
      ) {
        return null;
      }
      console.warn('[community-tools] Failed to load WolframAlphaTool:', err);
      return null;
    }
  })();
  return _promise;
}
