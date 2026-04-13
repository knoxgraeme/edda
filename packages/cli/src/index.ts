#!/usr/bin/env node

/**
 * Edda CLI — setup wizard, deployment helpers, and terminal-first
 * knowledge / inbox browsing.
 *
 * Usage:
 *   edda init                           — interactive setup wizard
 *   edda migrate                        — run database migrations
 *   edda deploy fly|render              — deploy helpers
 *
 *   edda items search "<query>"        — semantic search
 *   edda items recent                  — recently created items
 *   edda items show <id>               — single item
 *   edda entities list                 — browse entities
 *   edda entities show <id-or-name>    — entity with linked items
 *   edda inbox                         — pending actions + confirmations + notifications
 *   edda threads list                  — conversation threads
 *   edda threads show <id>             — thread metadata
 *   edda tasks recent                  — recent agent task runs
 *   edda types list                    — item types
 *   edda skills list                   — available skills
 */

import { Command } from "commander";
import { init } from "./commands/init.js";
import { deploy } from "./commands/deploy.js";
import { migrate } from "./commands/migrate.js";
import { registerItemsCommands } from "./commands/items.js";
import { registerEntitiesCommands } from "./commands/entities.js";
import { registerInboxCommand } from "./commands/inbox.js";
import { registerThreadsCommands } from "./commands/threads.js";
import { registerTasksCommands } from "./commands/tasks.js";
import { registerCatalogCommands } from "./commands/catalog.js";

const program = new Command();

program
  .name("edda")
  .description("Edda — your personal AI assistant")
  .version("0.1.0")
  .option("--json", "Output results as JSON (applies to most read commands)");

// ─── Setup / deployment ────────────────────────────────────────────
program
  .command("init")
  .description("Interactive setup wizard")
  .option("--non-interactive", "Use defaults / env vars (CI mode)")
  .action(init);

program
  .command("deploy [target]")
  .description("Deploy Edda (fly | render)")
  .action(deploy);

program
  .command("migrate")
  .description("Run database migrations")
  .action(migrate);

// ─── Knowledge / browsing ──────────────────────────────────────────
registerItemsCommands(program);
registerEntitiesCommands(program);
registerInboxCommand(program);
registerThreadsCommands(program);
registerTasksCommands(program);
registerCatalogCommands(program);

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
