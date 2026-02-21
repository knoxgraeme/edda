/**
 * Entity browser — people, projects, companies, topics, places
 *
 * Server component that fetches confirmed entities from @edda/db.
 * Client component handles filtering, search, and inline editing.
 */

import { listEntities } from "@edda/db";
import { EntitiesClient } from "./entities-client";

export default async function EntitiesPage() {
  let entities;
  try {
    entities = await listEntities();
  } catch (err) {
    console.error("Failed to load entities:", err);
    return (
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Entities</h1>
        <p className="text-muted-foreground">
          Unable to load entities. Make sure the database is running and
          migrations have been applied.
        </p>
      </main>
    );
  }

  return <EntitiesClient entities={entities} />;
}
