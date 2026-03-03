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

/** Validates a standard 5-field cron expression (minute hour day month weekday). */
const CRON_FIELD = /^(\*|(\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?|\*\/\d+)$/;
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f));
}

