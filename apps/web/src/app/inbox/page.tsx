/**
 * Notification inbox — pending confirmations
 *
 * Server component that fetches all unconfirmed items, entities, and item types.
 * Client component handles approve/reject actions.
 */

import { getPendingItems } from "@edda/db";
import { InboxClient } from "./inbox-client";

export default async function InboxPage() {
  let pending;
  try {
    pending = await getPendingItems();
  } catch (err) {
    console.error("Failed to load inbox:", err);
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Inbox</h1>
        <p className="text-muted-foreground">
          Unable to load inbox. Make sure the database is running and migrations
          have been applied.
        </p>
      </main>
    );
  }

  return <InboxClient items={pending} />;
}
