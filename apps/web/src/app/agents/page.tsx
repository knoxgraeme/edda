import { getAgents, getLatestRunPerAgent } from "@edda/db";
import { AgentsClient } from "./agents-client";

export default async function AgentsPage() {
  const [agents, runMap] = await Promise.all([getAgents(), getLatestRunPerAgent()]);

  const serialize = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  return <AgentsClient agents={serialize(agents)} lastRuns={serialize(runMap)} />;
}
