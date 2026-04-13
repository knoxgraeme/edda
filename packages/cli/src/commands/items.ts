/**
 * `edda items ...` — search, list, and show items.
 *
 *   edda items search <query> [--type <t>] [--limit <n>] [--json]
 *   edda items recent [--type <t>] [--limit <n>] [--json]
 *   edda items show <id> [--json]
 *
 * `search` requires a running backend (for query embedding).
 * `recent` and `show` go directly to Postgres via @edda/db.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../lib/db.js";
import { backendPost } from "../lib/backend.js";
import { runAction } from "../lib/run.js";
import {
  printTable,
  printJson,
  printKeyValue,
  formatDate,
  formatContent,
  formatId,
  indent,
  wantsJson,
  type Column,
} from "../lib/output.js";

interface SearchResponse {
  results?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
}

const ITEM_LIST_COLUMNS: Column[] = [
  { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
  { key: "type", header: "Type", width: 16 },
  { key: "content", header: "Content", width: 60, format: (v) => formatContent(v) },
  { key: "created_at", header: "Created", width: 10, format: formatDate },
];

export function registerItemsCommands(program: Command) {
  const items = program.command("items").description("Search and browse items");

  items
    .command("search <query>")
    .description("Semantic search over items (requires backend running)")
    .option("-t, --type <type>", "Filter by item type")
    .option("-l, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (query: string, options: { type?: string; limit: string; json?: boolean }) => {
        const result = await backendPost<SearchResponse>("/api/search/items", {
          query,
          type: options.type,
          limit: Number(options.limit),
        });
        const rows = result.results ?? result.items ?? [];

        if (wantsJson(options, program)) {
          printJson(rows);
          return;
        }

        const columns: Column[] = [
          { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
          { key: "type", header: "Type", width: 16 },
          { key: "content", header: "Content", width: 50, format: (v) => formatContent(v, 50) },
          {
            key: "similarity",
            header: "Score",
            width: 6,
            format: (v) => (typeof v === "number" ? v.toFixed(3) : ""),
          },
          { key: "last_reinforced_at", header: "Reinforced", width: 10, format: formatDate },
        ];
        printTable(rows, columns);
      }),
    );

  items
    .command("recent")
    .description("List recently created items")
    .option("-t, --type <type>", "Filter by item type")
    .option("-s, --status <status>", "Filter by status (active|done|archived|snoozed)")
    .option("-l, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(
      runAction(
        async (options: { type?: string; status?: string; limit: string; json?: boolean }) => {
          const db = await getDb();
          const rows = await db.listRecentItems({
            type: options.type,
            status: options.status,
            limit: Number(options.limit),
          });

          if (wantsJson(options, program)) {
            printJson(rows);
            return;
          }
          printTable(rows, ITEM_LIST_COLUMNS);
        },
      ),
    );

  items
    .command("show <id>")
    .description("Show a single item by ID")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (id: string, options: { json?: boolean }) => {
        const db = await getDb();
        const item = await db.getItemById(id);
        if (!item) throw new Error(`Item not found: ${id}`);

        if (wantsJson(options, program)) {
          printJson(item);
          return;
        }

        printKeyValue("Item", [
          ["id", item.id],
          ["type", item.type],
          ["status", item.status],
          ["source", item.source],
          ["day", item.day],
          ["created", formatDate(item.created_at)],
          ["updated", formatDate(item.updated_at)],
          ["reinforced", item.last_reinforced_at ? formatDate(item.last_reinforced_at) : "—"],
        ]);
        console.log();
        console.log(chalk.bold("Content"));
        console.log(indent(String(item.content ?? "")));
        if (item.summary) {
          console.log();
          console.log(chalk.bold("Summary"));
          console.log(indent(String(item.summary)));
        }
        if (item.metadata && Object.keys(item.metadata).length > 0) {
          console.log();
          console.log(chalk.bold("Metadata"));
          console.log(indent(JSON.stringify(item.metadata, null, 2)));
        }
      }),
    );
}
