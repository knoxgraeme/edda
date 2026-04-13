/**
 * Walk up from cwd looking for a `.env` file, parse it, and merge its
 * values into `process.env`. Existing `process.env` values win — we
 * never overwrite something the shell already set.
 *
 * Used by every non-init CLI command so that `@edda/db` picks up
 * `DATABASE_URL` automatically when run from a subdirectory of the repo.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnvFile } from "./env.js";

let loaded = false;

export async function loadEnv(): Promise<void> {
  if (loaded) return;
  loaded = true;

  const envPath = findEnvFile(process.cwd());
  if (!envPath) return;

  try {
    const content = await readFile(envPath, "utf8");
    const parsed = parseEnvFile(content);
    for (const [key, value] of parsed) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silent — missing/unreadable .env is fine; the caller will
    // surface a clearer error when it actually needs a variable.
  }
}

function findEnvFile(start: string): string | null {
  let dir = start;
  // Bound the walk to avoid pathological cases.
  for (let i = 0; i < 20; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
