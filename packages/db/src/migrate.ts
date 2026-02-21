/**
 * Migration runner — applies SQL files in order
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

export async function runMigrations(pool?: Pool): Promise<void> {
  const db = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });

  // Create migrations tracking table
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Get already-applied migrations
  const { rows: applied } = await db.query("SELECT name FROM _migrations ORDER BY name");
  const appliedSet = new Set(applied.map((r) => r.name));

  // Read and sort migration files
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`  Applying: ${file}`);

    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${err}`);
    }
  }

  if (!pool) await db.end();
  console.log("  Migrations complete.");
}

// Run directly: tsx src/migrate.ts
if (process.argv[1]?.includes("migrate")) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
