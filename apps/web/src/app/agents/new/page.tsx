import { getAgentNames } from "@edda/db";
import { NewAgentClient } from "./new-agent-client";

export default async function NewAgentPage() {
  const agentNames = await getAgentNames();
  return <NewAgentClient availableAgents={agentNames} />;
}
