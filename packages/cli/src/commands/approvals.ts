/**
 * `edda approve`, `edda reject`, `edda confirm` — resolve pending items.
 *
 *   edda approve <pending-action-id>
 *   edda reject <pending-action-id>
 *   edda confirm <table>/<id>          (items | entities | item_types | paired_users)
 *   edda reject-confirmation <table>/<id>
 *
 * Approvals go through the backend so the approved tool actually executes
 * and channel confirmation messages get cleaned up. Confirmations (the
 * older "is this new entity/item/type OK?" flow) are plain DB updates.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../lib/db.js";
import { backendPost } from "../lib/backend.js";
import { runAction } from "../lib/run.js";

const VALID_CONFIRM_TABLES = new Set([
  "items",
  "entities",
  "item_types",
  "paired_users",
  "telegram_paired_users",
]);

type ConfirmableTable =
  | "items"
  | "entities"
  | "item_types"
  | "paired_users"
  | "telegram_paired_users";

export function registerApprovalCommands(program: Command) {
  // ── approve ─────────────────────────────────────────────────────
  program
    .command("approve <id>")
    .description("Approve a pending tool action (goes through the backend to execute the tool)")
    .action(
      runAction(async (id: string) => {
        const res = await backendPost<{ action: unknown; tool_result: unknown }>(
          `/api/pending-actions/${encodeURIComponent(id)}/resolve`,
          { decision: "approved", resolved_by: "cli" },
        );
        console.log(chalk.green(`✓ Approved ${id}`));
        if (res.tool_result !== null && res.tool_result !== undefined) {
          console.log();
          console.log(chalk.dim("Tool result:"));
          console.log(
            typeof res.tool_result === "string"
              ? res.tool_result
              : JSON.stringify(res.tool_result, null, 2),
          );
        }
      }),
    );

  // ── reject ──────────────────────────────────────────────────────
  program
    .command("reject <id>")
    .description("Reject a pending tool action")
    .action(
      runAction(async (id: string) => {
        await backendPost(
          `/api/pending-actions/${encodeURIComponent(id)}/resolve`,
          { decision: "rejected", resolved_by: "cli" },
        );
        console.log(chalk.green(`✓ Rejected ${id}`));
      }),
    );

  // ── confirm (for items / entities / types / pairings) ──────────
  program
    .command("confirm <target>")
    .description(
      "Confirm a pending item/entity/type/pairing. Target format: <table>/<id>, e.g. items/abc-123",
    )
    .action(
      runAction(async (target: string) => {
        const { table, id } = parseTarget(target);
        const db = await getDb();
        await db.confirmPending(table, id);
        console.log(chalk.green(`✓ Confirmed ${table}/${id}`));
      }),
    );

  program
    .command("reject-confirmation <target>")
    .description("Reject a pending item/entity/type/pairing. Target format: <table>/<id>")
    .action(
      runAction(async (target: string) => {
        const { table, id } = parseTarget(target);
        const db = await getDb();
        await db.rejectPending(table, id);
        console.log(chalk.green(`✓ Rejected ${table}/${id}`));
      }),
    );
}

function parseTarget(target: string): { table: ConfirmableTable; id: string } {
  const slashIdx = target.indexOf("/");
  if (slashIdx <= 0) {
    throw new Error(`Target must be <table>/<id>, got: ${target}`);
  }
  const table = target.slice(0, slashIdx);
  const id = target.slice(slashIdx + 1);
  if (!VALID_CONFIRM_TABLES.has(table)) {
    throw new Error(
      `Invalid table: ${table}. Expected one of: ${[...VALID_CONFIRM_TABLES].join(", ")}`,
    );
  }
  if (!id) {
    throw new Error(`Missing id after "/": ${target}`);
  }
  return { table: table as ConfirmableTable, id };
}
