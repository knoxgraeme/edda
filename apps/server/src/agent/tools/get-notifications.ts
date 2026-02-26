/**
 * Tool: get_notifications — Read unread notifications for the calling agent.
 *
 * Returns unread notifications and marks them as read. Agents use this
 * to consume notifications from other agents or schedules.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { claimUnreadNotifications } from "@edda/db";
import { getAgentName } from "../tool-helpers.js";

export const getNotificationsSchema = z.object({});

export const getNotificationsTool = tool(
  async (_input, config) => {
    const agentName = getAgentName(config);
    if (!agentName) {
      throw new Error("agent_name required in configurable");
    }

    const notifications = await claimUnreadNotifications(agentName);
    if (notifications.length === 0) {
      return JSON.stringify({ notifications: [] });
    }

    return JSON.stringify({
      notifications: notifications.map((n) => ({
        id: n.id,
        from: (n.detail as Record<string, unknown>)?.agent_name ?? n.source_type,
        schedule: (n.detail as Record<string, unknown>)?.schedule_name ?? null,
        summary: n.summary,
        priority: n.priority,
        created_at: n.created_at,
      })),
    });
  },
  {
    name: "get_notifications",
    description:
      "Read your unread notifications from other agents or schedules. " +
      "Returns notification content and marks them as read.",
    schema: getNotificationsSchema,
  },
);
