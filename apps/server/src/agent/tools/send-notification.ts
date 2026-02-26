/**
 * Tool: send_notification — Send a notification to the inbox or another agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentName } from "../tool-helpers.js";

export const sendNotificationSchema = z.object({
  target: z
    .string()
    .describe("Target: 'inbox' or 'agent:<name>' or 'agent:<name>:active'"),
  summary: z.string().describe("Short notification message"),
  priority: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe("Notification priority (default: normal)"),
  expires_in_hours: z
    .number()
    .min(1)
    .max(720)
    .optional()
    .describe("Hours until notification expires. Default: 72"),
});

export const sendNotificationTool = tool(
  async ({ target, summary, priority, expires_in_hours }, config) => {
    const callingAgent = getAgentName(config);
    const sourceId = callingAgent ?? "unknown";
    const expiresAfter = expires_in_hours ? `${expires_in_hours} hours` : undefined;

    // Use notify() which handles row creation, target parsing, and active triggering
    const { notify } = await import("../../utils/notify.js");
    await notify({
      sourceType: "agent",
      sourceId,
      targets: [target],
      summary,
      detail: { source_agent: sourceId },
      priority,
      expiresAfter,
    });

    return JSON.stringify({ sent: true, target });
  },
  {
    name: "send_notification",
    description: [
      "Send a notification to the inbox (user-facing) or another agent.",
      "Use 'inbox' to notify the user, 'agent:<name>' for passive delivery",
      "(agent reads it on next run), or 'agent:<name>:active' to trigger an",
      "immediate agent run with the notification content.",
    ].join(" "),
    schema: sendNotificationSchema,
  },
);
