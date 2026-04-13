/**
 * `edda types ...` and `edda skills ...` — read-only catalog listings.
 *
 *   edda types list
 *   edda skills list
 */

import type { Command } from "commander";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import { printTable, printJson, formatContent, wantsJson, type Column } from "../lib/output.js";

export function registerCatalogCommands(program: Command) {
  const types = program.command("types").description("Browse item types");
  types
    .command("list")
    .description("List all item types")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { json?: boolean }) => {
        const db = await getDb();
        const rows = await db.getItemTypes();

        if (wantsJson(options, program)) {
          printJson(rows);
          return;
        }

        const columns: Column[] = [
          { key: "icon", header: "", width: 3 },
          { key: "name", header: "Name", width: 18 },
          { key: "decay_half_life_days", header: "Decay (d)", width: 10 },
          { key: "description", header: "Description", width: 60, format: (v) => formatContent(v, 60) },
        ];
        printTable(rows, columns);
      }),
    );

  const skills = program.command("skills").description("Browse skills");
  skills
    .command("list")
    .description("List all skills")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { json?: boolean }) => {
        const db = await getDb();
        const rows = await db.getSkills();

        if (wantsJson(options, program)) {
          printJson(rows);
          return;
        }

        const columns: Column[] = [
          { key: "name", header: "Name", width: 24 },
          { key: "is_system", header: "System", width: 7, format: (v) => (v ? "yes" : "no") },
          { key: "version", header: "Ver", width: 4 },
          { key: "description", header: "Description", width: 60, format: (v) => formatContent(v, 60) },
        ];
        printTable(rows, columns);
      }),
    );
}
