/**
 * `edda memory ...` — view and edit an agent's AGENTS.md.
 *
 *   edda memory show <agent>
 *   edda memory edit <agent>
 *   edda memory versions <agent> [--limit <n>]
 *   edda memory diff <agent> <v1> <v2>
 *
 * `edit` opens the latest AGENTS.md in $EDITOR and only writes a
 * new version row when the content actually changed.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../lib/db.js";
import { openInEditor } from "../lib/editor.js";
import { lineDiff } from "../lib/diff.js";
import { runAction } from "../lib/run.js";
import { printTable, printJson, formatDate, type Column } from "../lib/output.js";

export function registerMemoryCommands(program: Command) {
  const memory = program.command("memory").description("View and edit agent AGENTS.md");

  // ── show ────────────────────────────────────────────────────────
  memory
    .command("show <agent>")
    .description("Print the latest AGENTS.md for an agent")
    .option("--json", "Output as JSON (includes version metadata)")
    .action(
      runAction(async (agentName: string, options: { json?: boolean }) => {
        const db = await getDb();
        await assertAgentExists(db, agentName);

        const latest = await db.getLatestAgentsMd(agentName);
        if (!latest) {
          console.log(chalk.dim(`No AGENTS.md for "${agentName}" yet.`));
          return;
        }

        if (options.json || program.opts().json) {
          printJson(latest);
          return;
        }

        console.log(chalk.dim(`# version ${latest.id} — ${formatDate(latest.created_at)}`));
        console.log();
        process.stdout.write(latest.content);
        if (!latest.content.endsWith("\n")) process.stdout.write("\n");
      }),
    );

  // ── edit ────────────────────────────────────────────────────────
  memory
    .command("edit <agent>")
    .description("Open AGENTS.md in $EDITOR and save a new version if changed")
    .action(
      runAction(async (agentName: string) => {
        const db = await getDb();
        await assertAgentExists(db, agentName);

        const current = await db.getAgentsMdContent(agentName);
        const seed = current || DEFAULT_AGENTS_MD_SCAFFOLD;

        console.log(chalk.dim(`Opening ${process.env.EDITOR || "vi"}…`));
        const edited = await openInEditor(seed, {
          suffix: ".md",
          prefix: `edda-${agentName}-agentsmd`,
        });

        if (edited === current) {
          console.log(chalk.dim("No changes — nothing saved."));
          return;
        }
        if (!edited.trim() && !current) {
          console.log(chalk.dim("Empty content — nothing saved."));
          return;
        }

        const version = await db.saveAgentsMdVersion({
          content: edited,
          agentName,
        });
        console.log(
          chalk.green("✓ Saved version") +
            " " +
            chalk.bold(String(version.id)) +
            chalk.dim(` (${edited.length} chars)`),
        );
      }),
    );

  // ── versions ────────────────────────────────────────────────────
  memory
    .command("versions <agent>")
    .description("List AGENTS.md versions for an agent")
    .option("-l, --limit <n>", "Max versions to show", "20")
    .option("--json", "Output as JSON")
    .action(
      runAction(
        async (agentName: string, options: { limit: string; json?: boolean }) => {
          const db = await getDb();
          await assertAgentExists(db, agentName);

          const versions = await db.listAgentsMdVersions(
            agentName,
            Number(options.limit),
          );
          if (versions.length === 0) {
            console.log(chalk.dim(`No AGENTS.md versions for "${agentName}" yet.`));
            return;
          }

          if (options.json || program.opts().json) {
            printJson(versions);
            return;
          }

          const columns: Column[] = [
            { key: "id", header: "Version", width: 8 },
            { key: "created_at", header: "Created", width: 12, format: formatDate },
            {
              key: "content",
              header: "Size",
              width: 8,
              format: (v) => `${typeof v === "string" ? v.length : 0}ch`,
            },
            {
              key: "content",
              header: "First line",
              width: 60,
              format: (v) => firstLine(typeof v === "string" ? v : ""),
            },
          ];
          printTable(versions as unknown as Record<string, unknown>[], columns);
        },
      ),
    );

  // ── diff ────────────────────────────────────────────────────────
  memory
    .command("diff <agent> <v1> <v2>")
    .description("Show a line-level diff between two AGENTS.md versions")
    .action(
      runAction(async (agentName: string, v1: string, v2: string) => {
        const db = await getDb();
        await assertAgentExists(db, agentName);

        const id1 = Number(v1);
        const id2 = Number(v2);
        if (!Number.isInteger(id1) || !Number.isInteger(id2)) {
          console.error(chalk.red("Version IDs must be integers"));
          process.exitCode = 1;
          return;
        }

        const [a, b] = await Promise.all([
          db.getAgentsMdVersionById(id1),
          db.getAgentsMdVersionById(id2),
        ]);

        if (!a || a.agent_name !== agentName) {
          console.error(chalk.red(`Version ${id1} not found for agent "${agentName}"`));
          process.exitCode = 1;
          return;
        }
        if (!b || b.agent_name !== agentName) {
          console.error(chalk.red(`Version ${id2} not found for agent "${agentName}"`));
          process.exitCode = 1;
          return;
        }

        console.log(
          chalk.dim(
            `--- v${a.id} (${formatDate(a.created_at)})\n+++ v${b.id} (${formatDate(b.created_at)})`,
          ),
        );
        console.log();
        console.log(lineDiff(a.content, b.content));
      }),
    );
}

// ─── helpers ────────────────────────────────────────────────────────

const DEFAULT_AGENTS_MD_SCAFFOLD = `# AGENTS.md

Operating notes for serving this user well.

## Communication
(How the user prefers to be addressed, tone, response length, formatting.)

## Patterns
(Behavioral patterns — what usually works, what they ask for.)

## Standards
(Quality bar for deliverables — tests, docs, commits, code style.)

## Corrections
(Things the user has pushed back on; do not repeat.)
`;

async function assertAgentExists(
  db: Awaited<ReturnType<typeof getDb>>,
  name: string,
): Promise<void> {
  const agent = await db.getAgentByName(name);
  if (!agent) {
    throw new Error(`Agent not found: ${name}`);
  }
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length > 60 ? line.slice(0, 59) + "…" : line;
}
