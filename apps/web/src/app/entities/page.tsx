/**
 * Entity browser — people, projects, companies, topics, places
 *
 * Server component fetches confirmed entities. The client renders a two-pane
 * list + detail view matching the Entities redesign handoff.
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
      <main className="p-6">
        <h1 className="mb-4 text-2xl font-bold">Entities</h1>
        <p className="text-muted-foreground">
          Unable to load entities. Make sure the database is running and
          migrations have been applied.
        </p>
      </main>
    );
  }

  return <EntitiesClient entities={entities} />;
}
