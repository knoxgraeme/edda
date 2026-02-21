/**
 * Dashboard page — daily overview
 *
 * Server component that fetches dashboard data from @edda/db.
 * Client components handle quick actions (complete, snooze, archive).
 */

import { getDashboard, getPendingConfirmationsCount } from "@edda/db";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  let data;
  let pendingCount;
  try {
    [data, pendingCount] = await Promise.all([
      getDashboard(),
      getPendingConfirmationsCount(),
    ]);
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    return (
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
        <p className="text-muted-foreground">
          Unable to load dashboard. Make sure the database is running and
          migrations have been applied.
        </p>
      </main>
    );
  }

  return <DashboardClient data={data} pendingCount={pendingCount} />;
}
