import {
  getAgents,
  getEnabledSchedules,
  getLatestRunPerAgent,
  getSettings,
} from "@edda/db";
import { AgentsClient } from "./agents-client";

export default async function AgentsPage() {
  // getSettings throws on fresh DBs that haven't been seeded yet
  // (`Settings row missing`). Fall back to `edda` so the fleet view still
  // renders — user can then seed via `pnpm db:seed-settings` or the UI.
  const [agents, runMap, schedules, settings] = await Promise.all([
    getAgents(),
    getLatestRunPerAgent(),
    getEnabledSchedules(),
    getSettings().catch(() => null),
  ]);

  const serialize = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  return (
    <AgentsClient
      agents={serialize(agents)}
      lastRuns={serialize(runMap)}
      schedules={serialize(schedules)}
      defaultAgent={settings?.default_agent ?? "edda"}
    />
  );
}
