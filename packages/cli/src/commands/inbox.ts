/**
 * `edda inbox` — unified view of pending actions, confirmations,
 * and unread inbox notifications.
 *
 * This is a snapshot. For live push of new pending items we'd need
 * a server-side SSE endpoint (deferred to Phase 5).
 */

import type { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import {
  printTable,
  printJson,
  formatDate,
  formatContent,
  formatId,
  type Column,
} from "../lib/output.js";

export function registerInboxCommand(program: Command) {
  program
    .command("inbox")
    .description("Show pending actions, confirmations, and unread notifications")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { json?: boolean }) => {
        const db = await getDb();

        const [pendingActions, confirmations, notifications] = await Promise.all([
          db.listPendingActions({ status: "pending", limit: 50 }),
          db.getPendingItems(),
          db.getInboxNotifications({ status: "unread", limit: 50 }),
        ]);

        if (options.json || program.opts().json) {
          printJson({ pendingActions, confirmations, notifications });
          return;
        }

        const total = pendingActions.length + confirmations.length + notifications.length;
        if (total === 0) {
          console.log(chalk.dim("Inbox is empty."));
          return;
        }

        if (pendingActions.length > 0) {
          console.log(chalk.bold.yellow(`\nPending actions (${pendingActions.length})`));
          const columns: Column[] = [
            { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
            { key: "agent_name", header: "Agent", width: 14 },
            { key: "tool_name", header: "Tool", width: 20 },
            { key: "description", header: "Description", width: 45, format: (v) => formatContent(v, 45) },
            { key: "expires_at", header: "Expires", width: 10, format: formatDate },
          ];
          printTable(pendingActions as unknown as Record<string, unknown>[], columns);
        }

        if (confirmations.length > 0) {
          console.log(chalk.bold.cyan(`\nConfirmations (${confirmations.length})`));
          const columns: Column[] = [
            { key: "id", header: "ID", width: 14, format: (v) => formatId(v, 14) },
            { key: "table", header: "Table", width: 20 },
            { key: "type", header: "Type", width: 16 },
            { key: "label", header: "Label", width: 50, format: (v) => formatContent(v, 50) },
            { key: "createdAt", header: "Created", width: 10, format: formatDate },
          ];
          printTable(
            confirmations as unknown as Record<string, unknown>[],
            columns,
          );
        }

        if (notifications.length > 0) {
          console.log(chalk.bold.magenta(`\nNotifications (${notifications.length} unread)`));
          const columns: Column[] = [
            { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
            { key: "priority", header: "Prio", width: 6 },
            { key: "source_type", header: "From", width: 12 },
            { key: "summary", header: "Summary", width: 55, format: (v) => formatContent(v, 55) },
            { key: "created_at", header: "Created", width: 10, format: formatDate },
          ];
          printTable(notifications as unknown as Record<string, unknown>[], columns);
        }
      }),
    );
}
