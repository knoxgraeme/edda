/**
 * LangSmith / Standalone eval wrapper
 *
 * Auto-detects LANGSMITH_API_KEY. When present, wraps describe/test
 * with LangSmith tracing + feedback. When absent, re-exports plain Vitest.
 */

import { describe as vitestDescribe, test as vitestTest } from "vitest";

const USE_LANGSMITH = !!process.env.LANGSMITH_API_KEY;

let lsModule: any = null;

if (USE_LANGSMITH) {
  try {
    lsModule = await import("langsmith/vitest");
  } catch {
    console.warn("langsmith/vitest not installed — falling back to plain Vitest");
  }
}

export const describe = lsModule?.describe ?? vitestDescribe;
export const test = lsModule?.test ?? vitestTest;

export const logFeedback: (opts: { key: string; score: number | boolean }) => void =
  lsModule?.logFeedback ?? (() => {});

export { expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
