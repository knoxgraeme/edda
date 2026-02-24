/**
 * Notification service — creates notification items for agent run completions/failures.
 */

import { createItem } from "@edda/db";

export interface NotifyParams {
  agentName: string;
  runId: string;
  summary: string;
  priority?: "low" | "normal" | "high";
}

export async function notify(params: NotifyParams): Promise<string> {
  const { agentName, runId, summary, priority = "normal" } = params;

  const item = await createItem({
    type: "notification",
    content: summary,
    source: "agent",
    metadata: {
      source_agent: agentName,
      source_run_id: runId,
      priority,
      channel: agentName,
    },
    confirmed: true,
  });

  return item.id;
}
