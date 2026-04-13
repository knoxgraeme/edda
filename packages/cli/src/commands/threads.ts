/**
 * `edda threads ...` — browse conversation threads.
 *
 *   edda threads list [--agent <n>] [--limit <n>]
 *   edda threads show <id>
 *
 * Note: `threads show` renders only thread metadata. Full transcript
 * rendering requires reading LangGraph checkpointer state; deferred
 * to a later phase.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import {
  printTable,
  printJson,
  printKeyValue,
  formatDate,
  formatContent,
  wantsJson,
  type Column,
} from "../lib/output.js";

const THREAD_LIST_COLUMNS: Column[] = [
  { key: "thread_id", header: "Thread ID", width: 36 },
  { key: "title", header: "Title", width: 40, format: (v) => formatContent(v ?? "—", 40) },
  { key: "updated_at", header: "Updated", width: 10, format: formatDate },
];

export function registerThreadsCommands(program: Command) {
  const threads = program.command("threads").description("Browse conversation threads");

  threads
    .command("list")
    .description("List recent threads")
    .option("-a, --agent <name>", "Filter by agent name")
    .option("-l, --limit <n>", "Max results", "50")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { agent?: string; limit: string; json?: boolean }) => {
        const db = await getDb();
        const rows = await db.listThreads(Number(options.limit), options.agent);

        if (wantsJson(options, program)) {
          printJson(rows);
          return;
        }
        printTable(rows, THREAD_LIST_COLUMNS);
      }),
    );

  threads
    .command("show <id>")
    .description("Show thread metadata (transcript rendering: future phase)")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (id: string, options: { json?: boolean }) => {
        const db = await getDb();
        const rows = await db.listThreads(1000);
        const thread = rows.find((t) => t.thread_id === id);

        if (!thread) throw new Error(`Thread not found: ${id}`);

        if (wantsJson(options, program)) {
          printJson(thread);
          return;
        }

        printKeyValue("Thread", [
          ["thread_id", thread.thread_id],
          ["title", thread.title ?? "—"],
          ["updated", formatDate(thread.updated_at)],
        ]);

        if (thread.metadata && Object.keys(thread.metadata).length > 0) {
          console.log();
          console.log(chalk.bold("Metadata"));
          console.log("  " + JSON.stringify(thread.metadata, null, 2).split("\n").join("\n  "));
        }

        console.log();
        console.log(
          chalk.dim(
            "Full transcript rendering is not yet available in the CLI. Use the web UI for now.",
          ),
        );
      }),
    );
}
