import { getAgentByName, getRecentTaskRuns } from "@edda/db";
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

  const runs = await getRecentTaskRuns({ agent_name: name, limit: 20 });

  return <AgentDetailClient agent={agent} runs={runs} />;
}
