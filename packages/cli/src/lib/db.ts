/**
 * Lazy `@edda/db` wrapper for CLI commands.
 *
 * Ensures `.env` is loaded into process.env before the DB module is
 * imported (so `DATABASE_URL` is visible), then dynamically imports
 * the module. Returns the module namespace so commands can call query
 * functions directly.
 */

import { loadEnv } from "./load-env.js";

// Type-only import: at build time we need the shape, at runtime we
// load via `await import(...)` so env vars are set first.
type DbModule = typeof import("@edda/db");

let cached: DbModule | null = null;

export async function getDb(): Promise<DbModule> {
  if (cached) return cached;
  await loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Run `edda init` or make sure you're in a directory with a .env file.",
    );
  }
  cached = (await import("@edda/db")) as DbModule;
  return cached;
}

/** Close the DB pool — call at the end of a command so the process can exit cleanly. */
export async function closeDb(): Promise<void> {
  if (!cached) return;
  try {
    await cached.closePool();
  } catch {
    // best-effort
  }
}
