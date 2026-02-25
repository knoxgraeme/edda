import { getAgents, getLatestRunPerAgent } from "@edda/db";
import { AgentsClient } from "./agents-client";

export default async function AgentsPage() {
  const [agents, runMap] = await Promise.all([getAgents(), getLatestRunPerAgent()]);

  return <AgentsClient agents={agents} lastRuns={runMap} />;
}
