export const AGENT_NAME_RE = /^[a-z][a-z0-9_]*$/;

export const AVAILABLE_SKILLS = [
  { name: "admin", description: "Agent and MCP management", toolCount: 4 },
  { name: "capture", description: "Classify and store items", toolCount: 3 },
  { name: "daily-digest", description: "Morning briefing", toolCount: 3 },
  { name: "manage", description: "Edit, complete, archive items", toolCount: 4 },
  { name: "memory-maintenance", description: "Dedup, archive stale, resolve contradictions", toolCount: 5 },
  { name: "recall", description: "Search and retrieve information", toolCount: 3 },
  { name: "self-reflect", description: "Cross-session self-improvement from session notes", toolCount: 3 },
  { name: "type-evolution", description: "Evolve item type system", toolCount: 3 },
  { name: "weekly-report", description: "Weekly activity analysis and reporting", toolCount: 3 },
];

/**
 * All Edda tools, grouped by category.
 *
 * `agent.tools[]` is additive: it grants extra tools on top of whatever
 * the agent's selected skills already expose via `allowed-tools`. Empty
 * means the agent only gets its skills' tools.
 */
export const AVAILABLE_TOOL_GROUPS: Array<{
  group: string;
  tools: string[];
}> = [
  {
    group: "Items",
    tools: [
      "create_item",
      "batch_create_items",
      "update_item",
      "delete_item",
      "get_item_by_id",
      "search_items",
      "get_daily_summary",
      "get_list_contents",
      "get_timeline",
    ],
  },
  {
    group: "Lists",
    tools: ["create_list", "update_list"],
  },
  {
    group: "Entities",
    tools: [
      "upsert_entity",
      "link_item_entity",
      "list_entity_items",
      "get_entity_profile",
      "list_entities",
    ],
  },
  {
    group: "Types",
    tools: ["create_item_type", "list_item_types"],
  },
  {
    group: "Threads",
    tools: [
      "list_unprocessed_threads",
      "get_thread_messages",
      "mark_thread_processed",
      "list_threads",
    ],
  },
  {
    group: "Settings & MCP",
    tools: [
      "get_settings",
      "update_settings",
      "add_mcp_connection",
      "list_mcp_connections",
      "update_mcp_connection",
      "remove_mcp_connection",
    ],
  },
  {
    group: "Confirmations",
    tools: ["confirm_pending", "reject_pending", "list_pending_items"],
  },
  {
    group: "Agents",
    tools: [
      "create_agent",
      "run_agent",
      "get_task_run",
      "list_agents",
      "update_agent",
      "delete_agent",
    ],
  },
  {
    group: "Self-awareness",
    tools: ["get_agents_md", "save_agents_md", "seed_agents_md", "list_my_runs"],
  },
  {
    group: "Notifications",
    tools: ["send_notification", "get_notifications"],
  },
  {
    group: "Channels",
    tools: ["list_channels", "manage_channel"],
  },
  {
    group: "Reminders",
    tools: ["create_reminder", "list_reminders", "cancel_reminder"],
  },
  {
    group: "Skills",
    tools: ["install_skill", "list_skills"],
  },
  {
    group: "Schedules",
    tools: [
      "create_schedule",
      "list_schedules",
      "update_schedule",
      "delete_schedule",
    ],
  },
];

/** Flat set of all tool names, for validating unknown tools. */
export const AVAILABLE_TOOLS: Set<string> = new Set(
  AVAILABLE_TOOL_GROUPS.flatMap((g) => g.tools),
);

/** Validates a standard 5-field cron expression (minute hour day month weekday). */
const CRON_FIELD = /^(\*|(\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?|\*\/\d+)$/;
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f));
}

