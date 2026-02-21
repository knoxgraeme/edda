/**
 * Seed default settings row (idempotent)
 */

import { Pool } from "pg";

export async function seedSettings(pool?: Pool): Promise<void> {
  const db = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });

  await db.query("INSERT INTO settings (id) VALUES (true) ON CONFLICT DO NOTHING");
  console.log("  Settings seeded.");

  if (!pool) await db.end();
}

// Run directly: tsx src/seed-settings.ts
if (process.argv[1]?.includes("seed-settings")) {
  seedSettings().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
