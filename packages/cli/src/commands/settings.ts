/**
 * `edda settings ...` — view and edit system settings (single-row table).
 *
 *   edda settings list                 (pretty-printed key/value)
 *   edda settings edit                 (interactive field picker)
 *   edda settings get <key>
 *   edda settings set <key> <value>    (type-coerces based on current column type)
 *   edda settings export               (all as JSON)
 *
 * Types are inferred at runtime from the current Settings row: a column
 * whose current value is a number expects a number, etc. Values of "null"
 * or empty string become SQL NULL.
 */

import type { Command } from "commander";
import chalk from "chalk";
import * as p from "@clack/prompts";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import { printJson, printKeyValue, wantsJson } from "../lib/output.js";

const READ_ONLY_KEYS = new Set(["id", "created_at", "updated_at"]);

export function registerSettingsCommands(program: Command) {
  const settings = program.command("settings").description("View and edit system settings");

  // ── list ────────────────────────────────────────────────────────
  settings
    .command("list")
    .description("Pretty-print all settings")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { json?: boolean }) => {
        const db = await getDb();
        const current = await db.getSettings();

        if (wantsJson(options, program)) {
          printJson(redact(current));
          return;
        }

        const pairs = editableEntries(current).map(
          ([key, value]) => [key, formatValue(value)] as [string, unknown],
        );
        printKeyValue("Settings", pairs);
      }),
    );

  // ── get ─────────────────────────────────────────────────────────
  settings
    .command("get <key>")
    .description("Print a single setting value to stdout")
    .action(
      runAction(async (key: string) => {
        const db = await getDb();
        const current = await db.getSettings();
        if (!(key in current)) {
          throw new Error(`Unknown setting: ${key}`);
        }
        const value = (current as unknown as Record<string, unknown>)[key];
        if (value === null || value === undefined) return;
        if (typeof value === "object") {
          process.stdout.write(JSON.stringify(value));
        } else {
          process.stdout.write(String(value));
        }
        process.stdout.write("\n");
      }),
    );

  // ── set ─────────────────────────────────────────────────────────
  settings
    .command("set <key> <value>")
    .description("Update a single setting value")
    .action(
      runAction(async (key: string, value: string) => {
        const db = await getDb();
        const current = await db.getSettings();
        if (!(key in current) || READ_ONLY_KEYS.has(key)) {
          throw new Error(`Unknown or read-only setting: ${key}`);
        }

        const coerced = coerceValue(value, (current as unknown as Record<string, unknown>)[key]);
        const updated = await db.updateSettings({ [key]: coerced });
        const after = (updated as unknown as Record<string, unknown>)[key];
        console.log(chalk.green(`✓ ${key} = ${formatValue(after)}`));
      }),
    );

  // ── export ──────────────────────────────────────────────────────
  settings
    .command("export")
    .description("Print all settings as JSON (suitable for redirecting to a file)")
    .action(
      runAction(async () => {
        const db = await getDb();
        const current = await db.getSettings();
        printJson(redact(current));
      }),
    );

  // ── edit (interactive) ──────────────────────────────────────────
  settings
    .command("edit")
    .description("Interactively edit settings — pick a field and change its value")
    .action(
      runAction(async () => {
        const db = await getDb();
        let current = await db.getSettings();
        const keys = editableEntries(current).map(([k]) => k);

        p.intro(chalk.bold("Edit settings"));

        while (true) {
          const key = await p.select({
            message: "Pick a setting to edit (or Done to finish)",
            options: [
              { value: "__done", label: "Done" },
              ...keys.map((k) => {
                const v = (current as unknown as Record<string, unknown>)[k];
                return {
                  value: k,
                  label: k,
                  hint: formatValue(v),
                };
              }),
            ],
          });
          if (p.isCancel(key) || key === "__done") break;

          const typedKey = key as string;
          const currentValue = (current as unknown as Record<string, unknown>)[typedKey];
          const typeHint = describeType(currentValue);

          const input = await p.text({
            message: `New value for ${typedKey} (${typeHint})`,
            initialValue:
              currentValue === null || currentValue === undefined
                ? ""
                : typeof currentValue === "object"
                  ? JSON.stringify(currentValue)
                  : String(currentValue),
          });
          if (p.isCancel(input)) continue;

          try {
            const coerced = coerceValue(input as string, currentValue);
            current = await db.updateSettings({ [typedKey]: coerced });
            p.log.success(`${typedKey} = ${formatValue(coerced)}`);
          } catch (err) {
            p.log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        p.outro(chalk.green("✓ Saved"));
      }),
    );
}

// ─── helpers ────────────────────────────────────────────────────────

function editableEntries(settings: unknown): Array<[string, unknown]> {
  return Object.entries(settings as Record<string, unknown>).filter(
    ([k]) => !READ_ONLY_KEYS.has(k),
  );
}

/**
 * Coerce a user-supplied string to the same type as the current value.
 * Empty string or "null" (case-insensitive) → null for nullable columns.
 */
function coerceValue(raw: string, currentValue: unknown): unknown {
  const trimmed = raw.trim();

  // Null handling
  if (trimmed === "" || trimmed.toLowerCase() === "null") {
    if (currentValue === null || typeof currentValue === "string") return null;
    // Numbers / booleans: empty string is likely user error, keep going
  }

  if (typeof currentValue === "number") {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      throw new Error(`Expected a number, got "${raw}"`);
    }
    return n;
  }

  if (typeof currentValue === "boolean") {
    const lower = trimmed.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "1") return true;
    if (lower === "false" || lower === "no" || lower === "0") return false;
    throw new Error(`Expected a boolean (true|false), got "${raw}"`);
  }

  // Arrays / objects: parse JSON
  if (Array.isArray(currentValue) || (typeof currentValue === "object" && currentValue !== null)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`Expected valid JSON, got "${raw}"`);
    }
  }

  return trimmed;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return chalk.dim("(null)");
  if (typeof value === "boolean") return value ? chalk.green("true") : chalk.red("false");
  if (typeof value === "number") return chalk.cyan(String(value));
  if (typeof value === "object") return chalk.dim(JSON.stringify(value));
  const str = String(value);
  if (str.length > 60) return str.slice(0, 59) + "…";
  return str;
}

function describeType(value: unknown): string {
  if (value === null || value === undefined) return "string | null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean (true|false)";
  if (Array.isArray(value)) return "JSON array";
  if (typeof value === "object") return "JSON object";
  return "string";
}

/** Strip things nobody wants in `settings export` output. */
function redact(settings: unknown): unknown {
  const copy = { ...(settings as Record<string, unknown>) };
  delete copy.id;
  return copy;
}
