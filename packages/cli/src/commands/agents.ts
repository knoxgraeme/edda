/**
 * `edda agents ...` — manage agents.
 *
 *   edda agents list [--json]
 *   edda agents show <name> [--json]
 *   edda agents create                        (interactive)
 *   edda agents edit <name>                   (interactive field picker)
 *   edda agents prompt <name>                 (print system_prompt, piped-friendly)
 *   edda agents delete <name> [--force]
 *   edda agents run <name> "<prompt>" [--wait] [--notify <target>...]
 *   edda agents runs <name> [--limit <n>]
 *
 * Most subcommands go directly against @edda/db. `run` is the one
 * exception — it hits the backend server because that's where the
 * agent runtime lives.
 */

import type { Command } from "commander";
import chalk from "chalk";
import * as p from "@clack/prompts";
import {
  LLM_PROVIDERS,
  type Agent,
  type ThreadLifetime,
} from "@edda/db";
import { getDb } from "../lib/db.js";
import { backendPost } from "../lib/backend.js";
import { openInEditor } from "../lib/editor.js";
import { runAction } from "../lib/run.js";
import {
  printTable,
  printJson,
  printKeyValue,
  formatDate,
  formatContent,
  formatId,
  type Column,
} from "../lib/output.js";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

const AGENT_LIST_COLUMNS: Column[] = [
  { key: "name", header: "Name", width: 20 },
  { key: "enabled", header: "Enabled", width: 8, format: (v) => (v ? "yes" : "no") },
  { key: "thread_lifetime", header: "Thread", width: 10 },
  { key: "model", header: "Model", width: 20, format: (v) => (v ? String(v) : "(default)") },
  {
    key: "skills",
    header: "Skills",
    width: 40,
    format: (v) => formatContent(Array.isArray(v) ? v.join(", ") : "", 40),
  },
];

const THREAD_LIFETIME_OPTIONS: Array<{ value: ThreadLifetime; label: string; hint?: string }> = [
  { value: "ephemeral", label: "ephemeral", hint: "new thread every run (default for new agents)" },
  { value: "daily", label: "daily", hint: "shared thread per day" },
  { value: "persistent", label: "persistent", hint: "single shared thread forever" },
];

export function registerAgentsCommands(program: Command) {
  const agents = program.command("agents").description("Manage agents");

  // ── list ────────────────────────────────────────────────────────
  agents
    .command("list")
    .description("List all agents")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { json?: boolean }) => {
        const db = await getDb();
        const rows = await db.getAgents();

        if (options.json || program.opts().json) {
          printJson(rows);
          return;
        }
        printTable(rows as unknown as Record<string, unknown>[], AGENT_LIST_COLUMNS);
      }),
    );

  // ── show ────────────────────────────────────────────────────────
  agents
    .command("show <name>")
    .description("Show agent configuration, schedules, channels, and recent runs")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (name: string, options: { json?: boolean }) => {
        const db = await getDb();
        const agent = await db.getAgentByName(name);
        if (!agent) {
          console.error(chalk.red(`Agent not found: ${name}`));
          process.exitCode = 1;
          return;
        }

        const [schedules, channels, runs] = await Promise.all([
          db.getSchedulesForAgent(agent.id),
          db.getChannelsByAgent(agent.id, { includeDisabled: true }),
          db.getRecentTaskRuns({ agent_name: name, limit: 5 }),
        ]);

        if (options.json || program.opts().json) {
          printJson({ agent, schedules, channels, runs });
          return;
        }

        printKeyValue("Agent", [
          ["name", agent.name],
          ["description", agent.description],
          ["enabled", agent.enabled ? "yes" : "no"],
          ["thread lifetime", agent.thread_lifetime],
          ["thread scope", agent.thread_scope],
          ["trigger", agent.trigger ?? "—"],
          ["model provider", agent.model_provider ?? "(default)"],
          ["model", agent.model ?? "(default)"],
          ["memory capture", agent.memory_capture ? "yes" : "no"],
          ["memory self-reflect", agent.memory_self_reflect ? "yes" : "no"],
          ["skills", (agent.skills ?? []).join(", ") || "—"],
          ["tools", (agent.tools ?? []).join(", ") || "(all)"],
          ["subagents", (agent.subagents ?? []).join(", ") || "—"],
          ["created", formatDate(agent.created_at)],
          ["updated", formatDate(agent.updated_at)],
        ]);

        if (agent.system_prompt) {
          console.log();
          console.log(chalk.bold("System prompt"));
          console.log(indent(agent.system_prompt));
        }

        if (schedules.length > 0) {
          console.log();
          console.log(chalk.bold(`Schedules (${schedules.length})`));
          printTable(schedules as unknown as Record<string, unknown>[], [
            { key: "name", header: "Name", width: 20 },
            { key: "cron", header: "Cron", width: 18 },
            { key: "enabled", header: "Enabled", width: 8, format: (v) => (v ? "yes" : "no") },
            { key: "skip_when_empty_type", header: "Skip when empty", width: 20 },
          ]);
        }

        if (channels.length > 0) {
          console.log();
          console.log(chalk.bold(`Channels (${channels.length})`));
          printTable(channels as unknown as Record<string, unknown>[], [
            { key: "platform", header: "Platform", width: 10 },
            { key: "external_id", header: "External ID", width: 30 },
            { key: "enabled", header: "Enabled", width: 8, format: (v) => (v ? "yes" : "no") },
            {
              key: "receive_announcements",
              header: "Announcements",
              width: 14,
              format: (v) => (v ? "yes" : "no"),
            },
          ]);
        }

        if (runs.length > 0) {
          console.log();
          console.log(chalk.bold(`Recent runs (${runs.length})`));
          printTable(runs as unknown as Record<string, unknown>[], [
            { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
            { key: "trigger", header: "Trigger", width: 10 },
            { key: "status", header: "Status", width: 10 },
            {
              key: "duration_ms",
              header: "Duration",
              width: 8,
              format: (v) => (typeof v === "number" ? `${Math.round(v / 1000)}s` : "—"),
            },
            { key: "created_at", header: "Created", width: 10, format: formatDate },
          ]);
        }
      }),
    );

  // ── create (interactive) ────────────────────────────────────────
  agents
    .command("create")
    .description("Interactively create a new agent")
    .action(
      runAction(async () => {
        const db = await getDb();

        p.intro(chalk.bold("Create agent"));

        const name = await p.text({
          message: "Agent name (lowercase, a-z0-9_)",
          placeholder: "my_agent",
          validate: (v) => {
            if (!v || !v.trim()) return "Required";
            if (!NAME_RE.test(v)) return "Must match /^[a-z][a-z0-9_]*$/";
          },
        });
        if (p.isCancel(name)) return cancel();

        const existing = await db.getAgentByName(name);
        if (existing) {
          p.log.error(`Agent "${name}" already exists.`);
          return;
        }

        const description = await p.text({
          message: "Description (one-line summary of what the agent does)",
          validate: (v) => {
            if (!v || !v.trim()) return "Required";
          },
        });
        if (p.isCancel(description)) return cancel();

        // Skills
        const allSkills = await db.getSkills();
        let skills: string[] = [];
        if (allSkills.length > 0) {
          const picked = await p.multiselect({
            message: "Skills (space to toggle, enter to confirm)",
            required: false,
            options: allSkills.map((s) => ({
              value: s.name,
              label: s.name,
              hint: s.description?.slice(0, 60),
            })),
          });
          if (p.isCancel(picked)) return cancel();
          skills = picked;
        }

        const threadLifetime = (await p.select({
          message: "Thread lifetime",
          options: THREAD_LIFETIME_OPTIONS,
          initialValue: "ephemeral",
        })) as ThreadLifetime | symbol;
        if (p.isCancel(threadLifetime)) return cancel();

        const editPrompt = await p.confirm({
          message: "Open $EDITOR now to write the system prompt?",
          initialValue: false,
        });
        if (p.isCancel(editPrompt)) return cancel();

        let systemPrompt: string | undefined;
        if (editPrompt) {
          p.log.info(`Opening ${process.env.EDITOR || "vi"} — save and close to continue.`);
          systemPrompt = (
            await openInEditor(SYSTEM_PROMPT_TEMPLATE, { suffix: ".md" })
          ).trim();
          if (!systemPrompt) systemPrompt = undefined;
        }

        const spinner = p.spinner();
        spinner.start("Creating agent...");
        const created = await db.createAgent({
          name: name as string,
          description: description as string,
          system_prompt: systemPrompt,
          skills,
          thread_lifetime: threadLifetime as ThreadLifetime,
        });
        spinner.stop(`Created agent "${created.name}" (${created.id})`);

        p.outro(
          `  ${chalk.dim("View it:")}  edda agents show ${created.name}\n` +
            `  ${chalk.dim("Edit it:")}  edda agents edit ${created.name}`,
        );
      }),
    );

  // ── edit (interactive) ──────────────────────────────────────────
  agents
    .command("edit <name>")
    .description("Interactively edit an existing agent")
    .action(
      runAction(async (name: string) => {
        const db = await getDb();

        let agent = await db.getAgentByName(name);
        if (!agent) {
          console.error(chalk.red(`Agent not found: ${name}`));
          process.exitCode = 1;
          return;
        }

        p.intro(chalk.bold(`Edit agent: ${agent.name}`));

        while (true) {
          printAgentSummaryShort(agent);

          const field = await p.select({
            message: "What do you want to edit?",
            options: [
              { value: "description", label: "Description" },
              { value: "system_prompt", label: "System prompt (opens $EDITOR)" },
              { value: "skills", label: "Skills" },
              { value: "thread_lifetime", label: "Thread lifetime" },
              { value: "model_provider", label: "Model provider" },
              { value: "model", label: "Model name" },
              {
                value: "toggle",
                label: agent.enabled ? "Disable agent" : "Enable agent",
              },
              { value: "done", label: "Done" },
            ],
          });
          if (p.isCancel(field) || field === "done") break;

          agent = await applyEdit(db, agent, field as EditableField);
        }

        p.outro(chalk.green("✓ Saved"));
      }),
    );

  // ── prompt (piped output) ───────────────────────────────────────
  agents
    .command("prompt <name>")
    .description("Print an agent's system prompt to stdout")
    .action(
      runAction(async (name: string) => {
        const db = await getDb();
        const agent = await db.getAgentByName(name);
        if (!agent) {
          console.error(chalk.red(`Agent not found: ${name}`));
          process.exitCode = 1;
          return;
        }
        if (agent.system_prompt) {
          process.stdout.write(agent.system_prompt);
          if (!agent.system_prompt.endsWith("\n")) process.stdout.write("\n");
        }
      }),
    );

  // ── delete ──────────────────────────────────────────────────────
  agents
    .command("delete <name>")
    .description("Delete an agent")
    .option("-f, --force", "Skip the confirmation prompt")
    .action(
      runAction(async (name: string, options: { force?: boolean }) => {
        const db = await getDb();
        const agent = await db.getAgentByName(name);
        if (!agent) {
          console.error(chalk.red(`Agent not found: ${name}`));
          process.exitCode = 1;
          return;
        }

        const settings = await db.getSettings();
        if (settings.default_agent === name) {
          console.error(
            chalk.red(
              `Cannot delete "${name}" — it's the current default agent. Change default_agent in settings first.`,
            ),
          );
          process.exitCode = 1;
          return;
        }

        if (!options.force) {
          const ok = await p.confirm({
            message: `Delete agent "${name}"? This cannot be undone.`,
            initialValue: false,
          });
          if (p.isCancel(ok) || !ok) {
            p.cancel("Delete cancelled");
            return;
          }
        }

        await db.deleteAgent(agent.id);
        console.log(chalk.green(`✓ Deleted "${name}"`));
      }),
    );

  // ── run (backend) ───────────────────────────────────────────────
  agents
    .command("run <name> <prompt>")
    .description("Trigger an on-demand agent run")
    .option("-w, --wait", "Poll until the run finishes and print the result")
    .option(
      "-n, --notify <target>",
      "Where to deliver the result (repeatable; default: inbox)",
      collect,
      [] as string[],
    )
    .action(
      runAction(
        async (
          name: string,
          prompt: string,
          options: { wait?: boolean; notify: string[] },
        ) => {
          const body = {
            prompt,
            notify: options.notify.length > 0 ? options.notify : ["inbox"],
          };

          const res = await backendPost<{ run_id: string }>(
            `/api/agents/${encodeURIComponent(name)}/run`,
            body,
          );
          console.log(
            chalk.green(`✓ Run started:`) + " " + chalk.bold(res.run_id),
          );

          if (options.wait) {
            await waitForRun(res.run_id);
          } else {
            console.log(
              chalk.dim(`  Poll with: edda tasks recent --agent ${name}`),
            );
          }
        },
      ),
    );

  // ── runs ────────────────────────────────────────────────────────
  agents
    .command("runs <name>")
    .description("Show recent task runs for an agent")
    .option("-l, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (name: string, options: { limit: string; json?: boolean }) => {
        const db = await getDb();
        const rows = await db.getRecentTaskRuns({
          agent_name: name,
          limit: Number(options.limit),
        });

        if (options.json || program.opts().json) {
          printJson(rows);
          return;
        }

        printTable(rows as unknown as Record<string, unknown>[], [
          { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
          { key: "trigger", header: "Trigger", width: 10 },
          { key: "status", header: "Status", width: 10 },
          {
            key: "duration_ms",
            header: "Duration",
            width: 8,
            format: (v) => (typeof v === "number" ? `${Math.round(v / 1000)}s` : "—"),
          },
          {
            key: "tokens_used",
            header: "Tokens",
            width: 8,
            format: (v) => (typeof v === "number" ? String(v) : "—"),
          },
          { key: "created_at", header: "Created", width: 10, format: formatDate },
        ]);
      }),
    );
}

// ─── helpers ────────────────────────────────────────────────────────

const SYSTEM_PROMPT_TEMPLATE = `# System Prompt

## Task
(What this agent does.)

## Output
(What format / quality the output should take.)

## Boundaries
(What this agent should NOT do.)
`;

type EditableField =
  | "description"
  | "system_prompt"
  | "skills"
  | "thread_lifetime"
  | "model_provider"
  | "model"
  | "toggle";

async function applyEdit(
  db: Awaited<ReturnType<typeof getDb>>,
  agent: Agent,
  field: EditableField,
): Promise<Agent> {
  switch (field) {
    case "description": {
      const v = await p.text({
        message: "Description",
        initialValue: agent.description,
        validate: (s) => (s.trim() ? undefined : "Required"),
      });
      if (p.isCancel(v)) return agent;
      return db.updateAgent(agent.id, { description: v as string });
    }
    case "system_prompt": {
      p.log.info(`Opening ${process.env.EDITOR || "vi"}…`);
      const updated = await openInEditor(agent.system_prompt ?? SYSTEM_PROMPT_TEMPLATE, {
        suffix: ".md",
        prefix: `edda-${agent.name}-prompt`,
      });
      return db.updateAgent(agent.id, { system_prompt: updated });
    }
    case "skills": {
      const allSkills = await db.getSkills();
      const picked = await p.multiselect({
        message: "Skills",
        required: false,
        initialValues: agent.skills ?? [],
        options: allSkills.map((s) => ({
          value: s.name,
          label: s.name,
          hint: s.description?.slice(0, 60),
        })),
      });
      if (p.isCancel(picked)) return agent;
      return db.updateAgent(agent.id, { skills: picked });
    }
    case "thread_lifetime": {
      const v = (await p.select({
        message: "Thread lifetime",
        options: THREAD_LIFETIME_OPTIONS,
        initialValue: agent.thread_lifetime,
      })) as ThreadLifetime | symbol;
      if (p.isCancel(v)) return agent;
      return db.updateAgent(agent.id, { thread_lifetime: v as ThreadLifetime });
    }
    case "model_provider": {
      const v = await p.select({
        message: "Model provider",
        options: [
          { value: "__default", label: "(use system default)" },
          ...LLM_PROVIDERS.map((name) => ({ value: name, label: name })),
        ],
        initialValue: agent.model_provider ?? "__default",
      });
      if (p.isCancel(v)) return agent;
      return db.updateAgent(agent.id, {
        model_provider: v === "__default" ? null : (v as (typeof LLM_PROVIDERS)[number]),
      });
    }
    case "model": {
      const v = await p.text({
        message: "Model name (empty = use system default)",
        initialValue: agent.model ?? "",
      });
      if (p.isCancel(v)) return agent;
      const trimmed = (v as string).trim();
      return db.updateAgent(agent.id, { model: trimmed || null });
    }
    case "toggle":
      return db.updateAgent(agent.id, { enabled: !agent.enabled });
  }
}

function printAgentSummaryShort(agent: Agent): void {
  console.log();
  console.log(chalk.dim("  name           "), agent.name);
  console.log(chalk.dim("  description    "), formatContent(agent.description, 70));
  console.log(chalk.dim("  enabled        "), agent.enabled ? "yes" : "no");
  console.log(chalk.dim("  thread lifetime"), agent.thread_lifetime);
  console.log(
    chalk.dim("  model          "),
    agent.model_provider ? `${agent.model_provider} / ${agent.model ?? "(default)"}` : "(default)",
  );
  console.log(chalk.dim("  skills         "), (agent.skills ?? []).join(", ") || "—");
  console.log();
}

function cancel(): void {
  p.cancel("Cancelled");
  process.exitCode = 0;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

async function waitForRun(runId: string): Promise<void> {
  const db = await getDb();
  const spinner = p.spinner();
  spinner.start("Waiting for run to finish…");
  const started = Date.now();
  try {
    while (true) {
      const run = await db.getTaskRunById(runId);
      if (!run) {
        spinner.stop("Run not found");
        return;
      }
      if (run.status === "completed" || run.status === "failed") {
        spinner.stop(
          run.status === "completed"
            ? chalk.green(`✓ completed in ${formatElapsed(started)}`)
            : chalk.red(`✗ failed in ${formatElapsed(started)}`),
        );
        if (run.output_summary) {
          console.log();
          console.log(run.output_summary);
        }
        if (run.error) {
          console.log();
          console.log(chalk.red(run.error));
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    spinner.stop("Polling failed");
    throw err;
  }
}

function formatElapsed(started: number): string {
  const s = Math.round((Date.now() - started) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
