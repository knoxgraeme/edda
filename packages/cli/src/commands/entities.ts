/**
 * `edda entities ...` — list and show entities.
 *
 *   edda entities list [--type <t>] [--search <term>] [--limit <n>] [--json]
 *   edda entities show <id-or-name> [--json]
 */

import type { Command } from "commander";
import chalk from "chalk";
import type { EntityType } from "@edda/db";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import {
  printTable,
  printJson,
  printKeyValue,
  formatDate,
  formatContent,
  formatId,
  wantsJson,
  type Column,
} from "../lib/output.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ENTITY_TYPES: ReadonlyArray<EntityType> = [
  "person",
  "project",
  "company",
  "topic",
  "place",
  "tool",
  "concept",
];

const ENTITY_LIST_COLUMNS: Column[] = [
  { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
  { key: "name", header: "Name", width: 30 },
  { key: "type", header: "Type", width: 12 },
  { key: "mention_count", header: "Mentions", width: 8 },
  { key: "last_seen_at", header: "Last seen", width: 10, format: formatDate },
];

export function registerEntitiesCommands(program: Command) {
  const entities = program.command("entities").description("Browse entities");

  entities
    .command("list")
    .description("List entities")
    .option("-t, --type <type>", "Filter by entity type (person|project|company|topic|place|tool|concept)")
    .option("-s, --search <term>", "Fuzzy-match name or alias")
    .option("-l, --limit <n>", "Max results", "50")
    .option("--json", "Output as JSON")
    .action(
      runAction(
        async (options: { type?: string; search?: string; limit: string; json?: boolean }) => {
          const db = await getDb();
          let type: EntityType | undefined;
          if (options.type) {
            if (!VALID_ENTITY_TYPES.includes(options.type as EntityType)) {
              throw new Error(
                `Invalid entity type: ${options.type}. Expected one of: ${VALID_ENTITY_TYPES.join(", ")}`,
              );
            }
            type = options.type as EntityType;
          }
          const rows = await db.listEntities({
            type,
            search: options.search,
            limit: Number(options.limit),
          });

          if (wantsJson(options, program)) {
            printJson(rows);
            return;
          }
          printTable(rows, ENTITY_LIST_COLUMNS);
        },
      ),
    );

  entities
    .command("show <id-or-name>")
    .description("Show an entity with its linked items and connections")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (idOrName: string, options: { json?: boolean }) => {
        const db = await getDb();

        const entity = UUID_RE.test(idOrName)
          ? await db.getEntityById(idOrName)
          : await db.resolveEntity(idOrName);

        if (!entity) throw new Error(`Entity not found: ${idOrName}`);

        const [items, connections] = await Promise.all([
          db.getEntityItems(entity.id, { limit: 20 }),
          db.getEntityConnections(entity.id, 10),
        ]);

        if (wantsJson(options, program)) {
          printJson({ entity, items, connections });
          return;
        }

        printKeyValue("Entity", [
          ["id", entity.id],
          ["name", entity.name],
          ["type", entity.type],
          ["aliases", (entity.aliases ?? []).join(", ") || "—"],
          ["mentions", entity.mention_count],
          ["last seen", entity.last_seen_at ? formatDate(entity.last_seen_at) : "—"],
          ["created", formatDate(entity.created_at)],
        ]);

        if (entity.description) {
          console.log();
          console.log(chalk.bold("Description"));
          console.log("  " + entity.description);
        }

        if (items.length > 0) {
          console.log();
          console.log(chalk.bold(`Recent items (${items.length})`));
          printTable(items, [
            { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
            { key: "type", header: "Type", width: 14 },
            { key: "content", header: "Content", width: 55, format: (v) => formatContent(v, 55) },
            { key: "created_at", header: "Created", width: 10, format: formatDate },
          ]);
        }

        if (connections.length > 0) {
          console.log();
          console.log(chalk.bold(`Connections (${connections.length})`));
          printTable(connections, [
            { key: "name", header: "Name", width: 30 },
            { key: "type", header: "Type", width: 12 },
            { key: "shared_items", header: "Shared", width: 7 },
            { key: "top_relationship", header: "Relation", width: 20 },
          ]);
        }
      }),
    );
}
