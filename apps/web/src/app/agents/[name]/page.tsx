import { getAgentByName, getRecentTaskRuns, getSchedulesForAgent, getAgentNames } from "@edda/db";
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

  const [runs, schedules, allNames] = await Promise.all([
    getRecentTaskRuns({ agent_name: name, limit: 20 }),
    getSchedulesForAgent(agent.id),
    getAgentNames(),
  ]);

  const agentNames = allNames.filter((n) => n !== name);

  return (
    <AgentDetailClient
      agent={agent}
      runs={runs}
      schedules={schedules}
      availableAgents={agentNames}
    />
  );
}
