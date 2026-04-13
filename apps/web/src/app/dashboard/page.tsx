/**
 * Dashboard page — daily overview
 *
 * Server component that fetches dashboard data from @edda/db. Client
 * components handle quick item actions (complete, snooze, archive)
 * and polling.
 */

import {
  getDashboard,
  getEnabledSchedules,
  getLatestRunPerAgent,
  getPendingConfirmationsCount,
  getRecentTaskRuns,
  getRunningTaskCount,
} from "@edda/db";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  let data;
  let pendingCount;
  let recentRuns;
  let activeCount;
  let schedules;
  let latestRunPerAgent;
  try {
    [
      data,
      pendingCount,
      recentRuns,
      activeCount,
      schedules,
      latestRunPerAgent,
    ] = await Promise.all([
      getDashboard(),
      getPendingConfirmationsCount(),
      getRecentTaskRuns({ limit: 20 }),
      getRunningTaskCount(),
      getEnabledSchedules(),
      getLatestRunPerAgent(),
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

  const serialize = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  return (
    <DashboardClient
      data={serialize(data)}
      pendingCount={pendingCount}
      recentRuns={serialize(recentRuns)}
      activeCount={activeCount}
      schedules={serialize(schedules)}
      latestRunPerAgent={serialize(latestRunPerAgent)}
    />
  );
}
