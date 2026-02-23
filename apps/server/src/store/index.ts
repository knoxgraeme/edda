/**
 * Shared PostgresStore singleton — persistent cross-thread storage
 *
 * Used by the agent (via StoreBackend), seed-skills, cron jobs,
 * and memory triage. All consumers share the same Postgres-backed
 * store tables (managed by PostgresStore.setup()).
 */

import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";

let storePromise: Promise<PostgresStore> | null = null;

export function getStore(): Promise<PostgresStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const connString = process.env.DATABASE_URL;
      if (!connString) throw new Error("DATABASE_URL is required for PostgresStore");
      const s = PostgresStore.fromConnString(connString);
      await s.setup();
      return s;
    })();
  }
  return storePromise;
}
