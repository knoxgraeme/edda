/**
 * `edda migrate` — Run database migrations
 *
 * Thin wrapper around @edda/db's migration runner.
 * Reads DATABASE_URL from .env or environment.
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import "dotenv/config";

export async function migrate() {
  p.intro(chalk.bold("Running Edda migrations"));

  if (!process.env.DATABASE_URL) {
    p.log.error("DATABASE_URL not set. Run `edda init` first or set it in .env");
    return;
  }

  const s = p.spinner();
  s.start("Running migrations...");

  try {
    const { runMigrations } = await import("@edda/db");
    await runMigrations();
    s.stop("All migrations applied");
  } catch (err) {
    s.stop("Migration failed");
    p.log.error(String(err));
    process.exit(1);
  }

  p.outro(chalk.green("Database is up to date"));
}
