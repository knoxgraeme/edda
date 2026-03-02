/**
 * Edda tools — single flat pool used by all agents and subagents.
 *
 * Tool scoping is handled by SKILL.md `allowed-tools` frontmatter + agent.tools[],
 * not by maintaining separate tool lists. All tools live in one pool; each agent's
 * skills determine which subset it actually receives.
 */

import type { StructuredTool } from "@langchain/core/tools";

// Item tools
import { createItemTool } from "./create-item.js";
import { batchCreateItemsTool } from "./batch-create-items.js";
import { updateItemTool } from "./update-item.js";
import { deleteItemTool } from "./delete-item.js";
import { getItemByIdTool } from "./get-item-by-id.js";
import { searchItemsTool } from "./search-items.js";
import { getDailySummaryTool } from "./get-daily-summary.js";
import { getListContentsTool } from "./list-contents.js";
import { getTimelineTool } from "./get-timeline.js";

// List tools
import { createListTool } from "./create-list.js";
import { updateListTool } from "./update-list.js";

// Entity tools
import { upsertEntityTool } from "./upsert-entity.js";
import { linkItemEntityTool } from "./link-item-entity.js";
import { listEntityItemsTool } from "./list-entity-items.js";
import { getEntityProfileTool } from "./get-entity-profile.js";
import { listEntitiesTool } from "./list-entities.js";

// Type tools
import { createItemTypeTool } from "./create-item-type.js";
import { listItemTypesTool } from "./list-item-types.js";

// Thread tools
import { listUnprocessedThreadsTool } from "./list-unprocessed-threads.js";
import { getThreadMessagesTool } from "./get-thread-messages.js";
import { markThreadProcessedTool } from "./mark-thread-processed.js";
import { listThreadsTool } from "./list-threads.js";

// Settings / MCP tools
import { getSettingsTool } from "./get-settings.js";
import { updateSettingsTool } from "./update-settings.js";
import { addMcpConnectionTool } from "./add-mcp-connection.js";
import { listMcpConnectionsTool } from "./list-mcp-connections.js";
import { updateMcpConnectionTool } from "./update-mcp-connection.js";
import { removeMcpConnectionTool } from "./remove-mcp-connection.js";

// Confirmation tools
import { confirmPendingTool } from "./confirm-pending.js";
import { rejectPendingTool } from "./reject-pending.js";
import { listPendingItemsTool } from "./list-pending-items.js";

// Agent management tools
import { createAgentTool } from "./create-agent.js";
import { runAgentTool } from "./run-agent.js";
import { getTaskRunTool } from "./get-task-run.js";
import { listAgentsTool } from "./list-agents.js";
import { updateAgentTool } from "./update-agent.js";
import { deleteAgentTool } from "./delete-agent.js";

// Agent self-awareness tools
import { getAgentsMdTool } from "./get-agents-md.js";
import { saveAgentsMdTool } from "./save-agents-md.js";
import { listMyRunsTool } from "./list-my-runs.js";

// Notification tools
import { sendNotificationTool } from "./send-notification.js";
import { getNotificationsTool } from "./get-notifications.js";

// Channel tools
import { listChannelsTool } from "./list-channels.js";
import { manageChannelTool } from "./manage-channel.js";

// Reminder tools
import { createReminderTool } from "./create-reminder.js";
import { listRemindersTool } from "./list-reminders.js";
import { cancelReminderTool } from "./cancel-reminder.js";

// Skill management tools
import { installSkillTool } from "./install-skill.js";

// Community tools (lazy-loaded from @langchain/community)
import { loadWikipediaTool } from "./wikipedia.js";
import { loadDuckDuckGoTool } from "./duckduckgo.js";
import { loadWolframAlphaTool } from "./wolframalpha.js";

/**
 * Load community tools from @langchain/community. Each returns null if
 * the package is missing or (for WolframAlpha) the env var is unset.
 */
export async function loadCommunityTools(): Promise<StructuredTool[]> {
  const results = await Promise.all([
    loadWikipediaTool(),
    loadDuckDuckGoTool(),
    loadWolframAlphaTool(),
  ]);
  return results.filter((t): t is StructuredTool => t !== null);
}

/**
 * All Edda tools — single pool shared by all agents.
 *
 * buildAgent() passes this full set (plus MCP/search/community tools added at runtime).
 * Each agent's tools are scoped via SKILL.md `allowed-tools` + agent.tools[].
 */
export const allTools = [
  // Item tools
  createItemTool,
  batchCreateItemsTool,
  updateItemTool,
  deleteItemTool,
  getItemByIdTool,
  searchItemsTool,
  getDailySummaryTool,
  getListContentsTool,
  getTimelineTool,

  // List tools
  createListTool,
  updateListTool,

  // Entity tools
  upsertEntityTool,
  linkItemEntityTool,
  listEntityItemsTool,
  getEntityProfileTool,
  listEntitiesTool,

  // Type tools
  createItemTypeTool,
  listItemTypesTool,

  // Thread tools
  listUnprocessedThreadsTool,
  getThreadMessagesTool,
  markThreadProcessedTool,
  listThreadsTool,

  // Settings / MCP tools
  getSettingsTool,
  updateSettingsTool,
  addMcpConnectionTool,
  listMcpConnectionsTool,
  updateMcpConnectionTool,
  removeMcpConnectionTool,

  // Confirmation tools
  confirmPendingTool,
  rejectPendingTool,
  listPendingItemsTool,

  // Agent management tools
  createAgentTool,
  runAgentTool,
  getTaskRunTool,
  listAgentsTool,
  updateAgentTool,
  deleteAgentTool,

  // Agent self-awareness tools
  getAgentsMdTool,
  saveAgentsMdTool,
  listMyRunsTool,

  // Notification tools
  sendNotificationTool,
  getNotificationsTool,

  // Channel tools
  listChannelsTool,
  manageChannelTool,

  // Reminder tools
  createReminderTool,
  listRemindersTool,
  cancelReminderTool,

  // Skill management tools
  installSkillTool,
];
