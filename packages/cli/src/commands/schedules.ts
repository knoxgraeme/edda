/**
 * `edda schedules ...` — per-agent cron schedules.
 *
 *   edda schedules list [--agent <name>]
 *   edda schedules show <id>
 *   edda schedules create <agent>             (interactive)
 *   edda schedules delete <id> [--force]
 *   edda schedules toggle <id>
 */

import type { Command } from "commander";
import chalk from "chalk";
import * as p from "@clack/prompts";
import type { ThreadLifetime } from "@edda/db";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import {
  printTable,
  printJson,
  printKeyValue,
  formatDate,
  formatId,
  type Column,
} from "../lib/output.js";

const SCHEDULE_LIST_COLUMNS: Column[] = [
  { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
  { key: "agent_name", header: "Agent", width: 16 },
  { key: "name", header: "Name", width: 18 },
  { key: "cron", header: "Cron", width: 16 },
  { key: "enabled", header: "Enabled", width: 8, format: (v) => (v ? "yes" : "no") },
  {
    key: "skip_when_empty_type",
    header: "Skip when empty",
    width: 20,
    format: (v) => (v ? String(v) : "—"),
  },
];

export function registerSchedulesCommands(program: Command) {
  const schedules = program.command("schedules").description("Manage agent cron schedules");

  // ── list ────────────────────────────────────────────────────────
  schedules
    .command("list")
    .description("List schedules across all agents (or one agent with --agent)")
    .option("-a, --agent <name>", "Filter to a single agent")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { agent?: string; json?: boolean }) => {
        const db = await getDb();

        let rows;
        if (options.agent) {
          const agent = await db.getAgentByName(options.agent);
          if (!agent) {
            throw new Error(`Agent not found: ${options.agent}`);
          }
          const list = await db.getSchedulesForAgent(agent.id);
          rows = list.map((s) => ({ ...s, agent_name: agent.name }));
        } else {
          rows = await db.listAllSchedules();
        }

        if (options.json || program.opts().json) {
          printJson(rows);
          return;
        }
        printTable(rows as unknown as Record<string, unknown>[], SCHEDULE_LIST_COLUMNS);
      }),
    );

  // ── show ────────────────────────────────────────────────────────
  schedules
    .command("show <id>")
    .description("Show a single schedule")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (id: string, options: { json?: boolean }) => {
        const db = await getDb();
        const schedule = await db.getScheduleById(id);
        if (!schedule) {
          throw new Error(`Schedule not found: ${id}`);
        }

        if (options.json || program.opts().json) {
          printJson(schedule);
          return;
        }

        printKeyValue("Schedule", [
          ["id", schedule.id],
          ["agent_id", schedule.agent_id],
          ["name", schedule.name],
          ["cron", schedule.cron],
          ["thread lifetime", schedule.thread_lifetime ?? "(agent default)"],
          ["enabled", schedule.enabled ? "yes" : "no"],
          ["notify", (schedule.notify ?? []).join(", ") || "—"],
          ["notify expires", schedule.notify_expires_after ?? "(default)"],
          ["skip when empty", schedule.skip_when_empty_type ?? "—"],
          ["created", formatDate(schedule.created_at)],
        ]);

        if (schedule.prompt) {
          console.log();
          console.log(chalk.bold("Prompt"));
          console.log(indent(schedule.prompt));
        }
      }),
    );

  // ── create (interactive) ────────────────────────────────────────
  schedules
    .command("create <agent>")
    .description("Interactively create a schedule for an agent")
    .action(
      runAction(async (agentName: string) => {
        const db = await getDb();
        const agent = await db.getAgentByName(agentName);
        if (!agent) {
          throw new Error(`Agent not found: ${agentName}`);
        }

        p.intro(chalk.bold(`New schedule for ${agent.name}`));

        const name = await p.text({
          message: "Schedule name (unique per agent, e.g. 'morning_digest')",
          validate: (v) => {
            if (!v || !v.trim()) return "Required";
          },
        });
        if (p.isCancel(name)) return cancelOut();

        const cron = await p.text({
          message: "Cron expression (5 fields, e.g. '0 7 * * *' for 7am daily)",
          validate: (v) => {
            if (!v || !v.trim()) return "Required";
            if (v.trim().split(/\s+/).length !== 5) return "Expected 5 space-separated fields";
          },
        });
        if (p.isCancel(cron)) return cancelOut();

        const prompt = await p.text({
          message: "Prompt (the message the agent sees when this schedule fires)",
          validate: (v) => {
            if (!v || !v.trim()) return "Required";
          },
        });
        if (p.isCancel(prompt)) return cancelOut();

        const wantOverride = await p.confirm({
          message: "Override the agent's default thread_lifetime for this schedule?",
          initialValue: false,
        });
        if (p.isCancel(wantOverride)) return cancelOut();

        let threadLifetime: ThreadLifetime | undefined;
        if (wantOverride) {
          const lifetime = (await p.select({
            message: "Thread lifetime",
            options: [
              { value: "ephemeral", label: "ephemeral (new thread per run)" },
              { value: "daily", label: "daily" },
              { value: "persistent", label: "persistent" },
            ],
          })) as ThreadLifetime | symbol;
          if (p.isCancel(lifetime)) return cancelOut();
          threadLifetime = lifetime as ThreadLifetime;
        }

        const notifyText = await p.text({
          message:
            "Notification targets, comma-separated (e.g. 'inbox,announce:edda'). Empty = no notify.",
          initialValue: "inbox",
        });
        if (p.isCancel(notifyText)) return cancelOut();
        const notify = (notifyText as string)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const skipType = await p.text({
          message:
            "Skip run when no new items of this type since last success (empty = always run)",
          placeholder: "session_note",
        });
        if (p.isCancel(skipType)) return cancelOut();

        const spinner = p.spinner();
        spinner.start("Creating schedule...");
        const created = await db.createSchedule({
          agent_id: agent.id,
          name: name as string,
          cron: cron as string,
          prompt: prompt as string,
          thread_lifetime: threadLifetime,
          notify,
          skip_when_empty_type: (skipType as string).trim() || null,
        });
        spinner.stop(`Created schedule "${created.name}" (${created.id})`);

        p.outro(
          `  ${chalk.dim("View it:")}  edda schedules show ${created.id}\n` +
            `  ${chalk.dim("Disable it:")}  edda schedules toggle ${created.id}`,
        );
      }),
    );

  // ── delete ──────────────────────────────────────────────────────
  schedules
    .command("delete <id>")
    .description("Delete a schedule")
    .option("-f, --force", "Skip the confirmation prompt")
    .action(
      runAction(async (id: string, options: { force?: boolean }) => {
        const db = await getDb();
        const schedule = await db.getScheduleById(id);
        if (!schedule) {
          throw new Error(`Schedule not found: ${id}`);
        }

        if (!options.force) {
          const ok = await p.confirm({
            message: `Delete schedule "${schedule.name}" (${schedule.cron})?`,
            initialValue: false,
          });
          if (p.isCancel(ok) || !ok) {
            p.cancel("Delete cancelled");
            return;
          }
        }

        await db.deleteSchedule(id);
        console.log(chalk.green(`✓ Deleted "${schedule.name}"`));
      }),
    );

  // ── toggle ──────────────────────────────────────────────────────
  schedules
    .command("toggle <id>")
    .description("Enable or disable a schedule")
    .action(
      runAction(async (id: string) => {
        const db = await getDb();
        const schedule = await db.getScheduleById(id);
        if (!schedule) {
          throw new Error(`Schedule not found: ${id}`);
        }
        const updated = await db.updateSchedule(id, { enabled: !schedule.enabled });
        console.log(
          chalk.green(
            `✓ ${updated.enabled ? "Enabled" : "Disabled"} schedule "${updated.name}"`,
          ),
        );
      }),
    );
}

function cancelOut(): void {
  p.cancel("Cancelled");
  process.exitCode = 0;
}

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
