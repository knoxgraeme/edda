export const AGENT_NAME_RE = /^[a-z][a-z0-9_]*$/;

export const AVAILABLE_SKILLS = [
  { name: "admin", description: "Agent and MCP management" },
  { name: "capture", description: "Classify and store items" },
  { name: "context_refresh", description: "Maintain AGENTS.md context" },
  { name: "daily_digest", description: "Morning briefing" },
  { name: "manage", description: "Edit, complete, archive items" },
  { name: "memory_extraction", description: "Extract knowledge from conversations" },
  { name: "recall", description: "Search and retrieve information" },
  { name: "type_evolution", description: "Evolve item type system" },
  { name: "weekly_reflect", description: "Weekly patterns and maintenance" },
];

/** Validates a standard 5-field cron expression (minute hour day month weekday). */
const CRON_FIELD = /^(\*|(\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?|\*\/\d+)$/;
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f));
}

export const MODEL_KEYS = [
  { value: "", label: "Default" },
  { value: "default_model", label: "default_model" },
  { value: "daily_digest_model", label: "daily_digest_model" },
  { value: "memory_catchup_model", label: "memory_catchup_model" },
  { value: "weekly_review_model", label: "weekly_review_model" },
  { value: "type_evolution_model", label: "type_evolution_model" },
  { value: "context_refresh_model", label: "context_refresh_model" },
];
