import { getAgentByName, getRecentTaskRuns, getSchedulesForAgent, getAgentNames, getChannelsByAgent } from "@edda/db";
import { notFound } from "next/navigation";
import { AgentDetailClient } from "./agent-detail-client";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const agent = await getAgentByName(name);
  if (!agent) notFound();

  const [runs, schedules, allNames, channels] = await Promise.all([
    getRecentTaskRuns({ agent_name: name, limit: 20 }),
    getSchedulesForAgent(agent.id),
    getAgentNames(),
    getChannelsByAgent(agent.id, { includeDisabled: true }),
  ]);

  const agentNames = allNames.filter((n) => n !== name);

  // JSON round-trip ensures all DB values (Date, pg interval objects, etc.)
  // are converted to plain serializable objects for the Client Component boundary.
  const serialize = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  return (
    <AgentDetailClient
      agent={serialize(agent)}
      runs={serialize(runs)}
      schedules={serialize(schedules)}
      channels={serialize(channels)}
      availableAgents={agentNames}
    />
  );
}
