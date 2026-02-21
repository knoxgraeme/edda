#!/usr/bin/env node

/**
 * Edda CLI — setup wizard and deployment helpers.
 *
 * Usage:
 *   npx edda init          — interactive setup wizard
 *   npx edda deploy fly    — deploy to Fly.io
 *   npx edda deploy render — deploy to Render
 *   npx edda migrate       — run database migrations
 */

import { Command } from "commander";
import { init } from "./commands/init.js";
import { deploy } from "./commands/deploy.js";
import { migrate } from "./commands/migrate.js";

const program = new Command();

program
  .name("edda")
  .description("Edda — your personal AI assistant")
  .version("0.1.0");

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

program.parse();
