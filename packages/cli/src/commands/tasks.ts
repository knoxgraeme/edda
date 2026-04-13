/**
 * `edda tasks ...` — browse agent task runs.
 *
 *   edda tasks recent [--agent <n>] [--status <s>] [--limit <n>]
 */

import type { Command } from "commander";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import { printTable, printJson, formatDate, formatId, type Column } from "../lib/output.js";

const TASK_RUN_COLUMNS: Column[] = [
  { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
  { key: "agent_name", header: "Agent", width: 16 },
  { key: "trigger", header: "Trigger", width: 10 },
  { key: "status", header: "Status", width: 10 },
  {
    key: "duration_ms",
    header: "Duration",
    width: 8,
    format: (v) => (typeof v === "number" ? `${Math.round(v / 1000)}s` : "—"),
  },
  {
    key: "tokens_used",
    header: "Tokens",
    width: 8,
    format: (v) => (typeof v === "number" ? String(v) : "—"),
  },
  { key: "created_at", header: "Created", width: 10, format: formatDate },
];

export function registerTasksCommands(program: Command) {
  const tasks = program.command("tasks").description("Browse agent task runs");

  tasks
    .command("recent")
    .description("List recent task runs")
    .option("-a, --agent <name>", "Filter by agent name")
    .option("-s, --status <status>", "Filter by status (pending|running|completed|failed)")
    .option("-l, --limit <n>", "Max results", "50")
    .option("--json", "Output as JSON")
    .action(
      runAction(
        async (options: { agent?: string; status?: string; limit: string; json?: boolean }) => {
          const db = await getDb();
          const rows = await db.getRecentTaskRuns({
            agent_name: options.agent,
            status: options.status as Parameters<typeof db.getRecentTaskRuns>[0] extends infer O
              ? O extends { status?: infer S }
                ? S
                : never
              : never,
            limit: Number(options.limit),
          });

          if (options.json || program.opts().json) {
            printJson(rows);
            return;
          }
          printTable(rows as unknown as Record<string, unknown>[], TASK_RUN_COLUMNS);
        },
      ),
    );
}
