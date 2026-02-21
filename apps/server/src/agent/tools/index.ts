/**
 * Edda tools — registered with the deep agent
 *
 * All tools follow LangChain's StructuredTool interface.
 * See cortex-spec-v4.md § Tools for full specifications.
 */

// Item tools (1A)
import { createItemTool } from "./create-item.js";
import { batchCreateItemsTool } from "./batch-create-items.js";
import { updateItemTool } from "./update-item.js";
import { searchItemsTool } from "./search-items.js";
import { getDashboardTool } from "./get-dashboard.js";
import { getListItemsTool } from "./get-list-items.js";
import { getTimelineTool } from "./get-timeline.js";

// Entity tools (1B)
import { upsertEntityTool } from "./upsert-entity.js";
import { linkItemEntityTool } from "./link-item-entity.js";
import { getEntityItemsTool } from "./get-entity-items.js";

// Type / Settings / MCP tools (1C)
import { createItemTypeTool } from "./create-item-type.js";
import { confirmPendingTool } from "./confirm-pending.js";
import { rejectPendingTool } from "./reject-pending.js";
import { getSettingsTool } from "./get-settings.js";
import { updateSettingsTool } from "./update-settings.js";
import { addMcpConnectionTool } from "./add-mcp-connection.js";
import { listMcpConnectionsTool } from "./list-mcp-connections.js";
import { updateMcpConnectionTool } from "./update-mcp-connection.js";
import { removeMcpConnectionTool } from "./remove-mcp-connection.js";

export {
  upsertEntityTool,
  linkItemEntityTool,
  getEntityItemsTool,
  createItemTypeTool,
  confirmPendingTool,
  rejectPendingTool,
  getSettingsTool,
  updateSettingsTool,
  addMcpConnectionTool,
  listMcpConnectionsTool,
  updateMcpConnectionTool,
  removeMcpConnectionTool,
};

// Item tool schema exports
export { createItemSchema } from "./create-item.js";
export { batchCreateItemsSchema } from "./batch-create-items.js";
export { updateItemSchema } from "./update-item.js";
export { searchItemsSchema } from "./search-items.js";
export { getDashboardSchema } from "./get-dashboard.js";
export { getListItemsSchema } from "./get-list-items.js";
export { getTimelineSchema } from "./get-timeline.js";

// Entity tool schema exports
export { upsertEntitySchema } from "./upsert-entity.js";
export { linkItemEntitySchema } from "./link-item-entity.js";
export { getEntityItemsSchema } from "./get-entity-items.js";

// Type / Settings / MCP tool schema exports
export { createItemTypeSchema } from "./create-item-type.js";
export { confirmPendingSchema } from "./confirm-pending.js";
export { rejectPendingSchema } from "./reject-pending.js";
export { getSettingsSchema } from "./get-settings.js";
export { updateSettingsSchema } from "./update-settings.js";
export { addMcpConnectionSchema } from "./add-mcp-connection.js";
export { listMcpConnectionsSchema } from "./list-mcp-connections.js";
export { updateMcpConnectionSchema } from "./update-mcp-connection.js";
export { removeMcpConnectionSchema } from "./remove-mcp-connection.js";

export const eddaTools = [
  // Item tools (1A)
  createItemTool,
  batchCreateItemsTool,
  updateItemTool,
  searchItemsTool,
  getDashboardTool,
  getListItemsTool,
  getTimelineTool,

  // Entity tools (1B)
  upsertEntityTool,
  linkItemEntityTool,
  getEntityItemsTool,

  // Type / Settings / MCP tools (1C)
  createItemTypeTool,
  confirmPendingTool,
  rejectPendingTool,
  getSettingsTool,
  updateSettingsTool,
  addMcpConnectionTool,
  listMcpConnectionsTool,
  updateMcpConnectionTool,
  removeMcpConnectionTool,
];
