import { getAgents, getRecentTaskRuns } from "@edda/db";
import { AgentsClient } from "./agents-client";

export default async function AgentsPage() {
  const agents = await getAgents();
  const agentRuns = await Promise.all(
    agents.map(async (a) => {
      const runs = await getRecentTaskRuns({ agent_name: a.name, limit: 1 });
      return { name: a.name, lastRun: runs[0] ?? null };
    }),
  );
  const runMap = Object.fromEntries(agentRuns.map((r) => [r.name, r.lastRun]));

  return <AgentsClient agents={agents} lastRuns={runMap} />;
}
