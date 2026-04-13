#!/usr/bin/env node

/**
 * Edda CLI — setup wizard, deployment helpers, and terminal-first
 * knowledge / inbox browsing, agent authoring, and memory editing.
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
 *
 *   edda agents list                   — list agents
 *   edda agents show <name>            — agent config + schedules + channels + runs
 *   edda agents create                 — interactive agent creator
 *   edda agents edit <name>            — interactive field picker + $EDITOR
 *   edda agents prompt <name>          — print system_prompt
 *   edda agents delete <name>          — delete an agent
 *   edda agents run <name> "<prompt>"  — trigger an on-demand run
 *   edda agents runs <name>            — recent task runs for an agent
 *   edda memory show <agent>           — print latest AGENTS.md
 *   edda memory edit <agent>           — open AGENTS.md in $EDITOR
 *   edda memory versions <agent>       — list AGENTS.md versions
 *   edda memory diff <agent> <v1> <v2> — diff two versions
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
import { registerAgentsCommands } from "./commands/agents.js";
import { registerMemoryCommands } from "./commands/memory.js";

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

// ─── Agent + memory authoring ──────────────────────────────────────
registerAgentsCommands(program);
registerMemoryCommands(program);

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
