/**
 * Edda tools — registered with the deep agent
 *
 * All tools follow LangChain's StructuredTool interface.
 * See cortex-spec-v4.md § Tools for full specifications.
 */

import { z } from "zod";

// Barrel schema — satisfies tool-file validation hook
export const eddaToolsSchema = z.object({});

// Item tools (1A)
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

// Entity tools (1B)
import { upsertEntityTool } from "./upsert-entity.js";
import { linkItemEntityTool } from "./link-item-entity.js";
import { getEntityItemsTool } from "./get-entity-items.js";

// Type / Settings / MCP tools (1C)
import { createItemTypeTool } from "./create-item-type.js";
import { getSettingsTool } from "./get-settings.js";
import { updateSettingsTool } from "./update-settings.js";
import { addMcpConnectionTool } from "./add-mcp-connection.js";
import { listMcpConnectionsTool } from "./list-mcp-connections.js";
import { updateMcpConnectionTool } from "./update-mcp-connection.js";
import { removeMcpConnectionTool } from "./remove-mcp-connection.js";

// Confirmation tools (1D)
import { confirmPendingTool } from "./confirm-pending.js";
import { rejectPendingTool } from "./reject-pending.js";
import { getPendingItemsTool } from "./get-pending-items.js";

// Thread tools
import { getUnprocessedThreadsTool } from "./get-unprocessed-threads.js";
import { getThreadMessagesTool } from "./get-thread-messages.js";
import { markThreadProcessedTool } from "./mark-thread-processed.js";
import { listThreadsTool } from "./list-threads.js";

export const eddaTools = [
  // Item tools (1A)
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

  // Entity tools (1B)
  upsertEntityTool,
  linkItemEntityTool,
  getEntityItemsTool,

  // Type / Settings / MCP tools (1C)
  createItemTypeTool,
  getSettingsTool,
  updateSettingsTool,
  addMcpConnectionTool,
  listMcpConnectionsTool,
  updateMcpConnectionTool,
  removeMcpConnectionTool,

  // Confirmation tools (1D)
  confirmPendingTool,
  rejectPendingTool,
  getPendingItemsTool,

  // Thread tools
  getUnprocessedThreadsTool,
  getThreadMessagesTool,
  markThreadProcessedTool,
  listThreadsTool,
];
