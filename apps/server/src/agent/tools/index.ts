/**
 * Edda tools — single flat pool used by all agents and subagents.
 *
 * Tool scoping is handled by SKILL.md `allowed-tools` frontmatter + agent.tools[],
 * not by maintaining separate tool lists. All tools live in one pool; each agent's
 * skills determine which subset it actually receives.
 */

import { z } from "zod";

// Barrel schema — satisfies tool-file validation hook
export const allToolsSchema = z.object({});

// Item tools
import { createItemTool } from "./create-item.js";
import { batchCreateItemsTool } from "./batch-create-items.js";
import { updateItemTool } from "./update-item.js";
import { deleteItemTool } from "./delete-item.js";
import { getItemByIdTool } from "./get-item-by-id.js";
import { searchItemsTool } from "./search-items.js";
import { getDashboardTool } from "./get-dashboard.js";
import { getListItemsTool } from "./get-list-items.js";
import { getTimelineTool } from "./get-timeline.js";
import { getAgentKnowledgeTool } from "./get-agent-knowledge.js";

// Entity tools
import { upsertEntityTool } from "./upsert-entity.js";
import { linkItemEntityTool } from "./link-item-entity.js";
import { getEntityItemsTool } from "./get-entity-items.js";
import { getEntityProfileTool } from "./get-entity-profile.js";
import { listEntitiesTool } from "./list-entities.js";

// Type tools
import { createItemTypeTool } from "./create-item-type.js";

// Thread tools
import { getUnprocessedThreadsTool } from "./get-unprocessed-threads.js";
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
import { getPendingItemsTool } from "./get-pending-items.js";

// Agent management tools
import { createAgentTool } from "./create-agent.js";
import { runAgentTool } from "./run-agent.js";
import { getTaskResultTool } from "./get-task-result.js";
import { listAgentsTool } from "./list-agents.js";
import { updateAgentTool } from "./update-agent.js";
import { deleteAgentTool } from "./delete-agent.js";

// Agent self-awareness tools
import { saveAgentsMdTool } from "./save-agents-md.js";
import { getMyHistoryTool } from "./get-my-history.js";

/**
 * All Edda tools — single pool shared by all agents.
 *
 * buildAgent() passes this full set (plus MCP/search tools added at runtime).
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
  getDashboardTool,
  getListItemsTool,
  getTimelineTool,
  getAgentKnowledgeTool,

  // Entity tools
  upsertEntityTool,
  linkItemEntityTool,
  getEntityItemsTool,
  getEntityProfileTool,
  listEntitiesTool,

  // Type tools
  createItemTypeTool,

  // Thread tools
  getUnprocessedThreadsTool,
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
  getPendingItemsTool,

  // Agent management tools
  createAgentTool,
  runAgentTool,
  getTaskResultTool,
  listAgentsTool,
  updateAgentTool,
  deleteAgentTool,

  // Agent self-awareness tools
  saveAgentsMdTool,
  getMyHistoryTool,
];
