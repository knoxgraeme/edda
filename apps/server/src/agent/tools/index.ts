/**
 * Edda tools — registered with the deep agent
 *
 * All tools follow LangChain's StructuredTool interface.
 * See cortex-spec-v4.md § Tools for full specifications.
 */

// TODO: Implement each tool per spec
// export { createItemTool } from "./create-item.js";
// export { batchCreateItemsTool } from "./batch-create-items.js";
// export { searchItemsTool } from "./search-items.js";
// export { getDashboardTool } from "./get-dashboard.js";
// export { updateItemTool } from "./update-item.js";
// export { archiveItemTool } from "./archive-item.js";
// export { deleteItemTool } from "./delete-item.js";
// export { confirmPendingTool } from "./confirm-pending.js";
// export { createItemTypeTool } from "./create-item-type.js";

// Recall tools
// export { getEntityItemsTool } from "./get-entity-items.js";
// export { getListItemsTool } from "./get-list-items.js";
// export { getTimelineTool } from "./get-timeline.js";
// export { resolveEntityTool } from "./resolve-entity.js";
// export { getAgentKnowledgeTool } from "./get-agent-knowledge.js";
// export { getSettingsTool } from "./get-settings.js";

// Placeholder export
export const eddaTools: unknown[] = [];

// Barrel schema — satisfies tool-file validation hook
export const eddaToolsSchema = {} as const;
