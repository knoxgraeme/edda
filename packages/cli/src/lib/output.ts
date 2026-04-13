/**
 * Shared output helpers for CLI commands.
 *
 * Provides:
 *  - `printTable` for tabular listings
 *  - `printJson` for `--json` output
 *  - `formatDate` for relative timestamps (e.g. "3h ago")
 *  - `formatContent` for truncating multiline content to a single line
 */

import chalk from "chalk";

export type Row = Record<string, unknown>;

export interface Column {
  key: string;
  header: string;
  /** Max display width. Auto-sized from content if omitted (capped at 60). */
  width?: number;
  format?: (value: unknown, row: Row) => string;
}

export function printTable(rows: Row[], columns: Column[]): void {
  if (rows.length === 0) {
    console.log(chalk.dim("(no rows)"));
    return;
  }

  const rendered = rows.map((row) =>
    columns.map((col) => (col.format ? col.format(row[col.key], row) : stringify(row[col.key]))),
  );

  const widths = columns.map((col, ci) => {
    if (col.width !== undefined) return col.width;
    const dataMax = Math.max(...rendered.map((r) => r[ci].length));
    return Math.min(Math.max(dataMax, col.header.length), 60);
  });

  const header = columns.map((col, i) => pad(col.header, widths[i])).join("  ");
  console.log(chalk.bold(header));
  console.log(chalk.dim(widths.map((w) => "─".repeat(w)).join("  ")));

  for (const cells of rendered) {
    const line = cells.map((cell, i) => pad(truncate(cell, widths[i]), widths[i])).join("  ");
    console.log(line);
  }
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printKeyValue(title: string, pairs: Array<[string, unknown]>): void {
  console.log(chalk.bold(title));
  const keyWidth = Math.max(...pairs.map(([k]) => k.length));
  for (const [key, value] of pairs) {
    console.log(`  ${chalk.dim(pad(key, keyWidth))}  ${stringify(value)}`);
  }
}

// ─── formatters ───────────────────────────────────────────────────

export function formatDate(value: unknown): string {
  if (!value) return "";
  const d = typeof value === "string" || value instanceof Date ? new Date(value as string) : null;
  if (!d || isNaN(d.getTime())) return stringify(value);

  const now = Date.now();
  const diff = now - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < 0) return d.toISOString().slice(0, 16).replace("T", " ");
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toISOString().slice(0, 10);
}

export function formatContent(value: unknown, max = 60): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  const cleaned = s.replace(/\s+/g, " ").trim();
  return truncate(cleaned, max);
}

export function formatId(value: unknown, length = 8): string {
  const s = stringify(value);
  return s.length > length ? s.slice(0, length) : s;
}

// ─── internals ────────────────────────────────────────────────────

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return s.slice(0, width - 1) + "…";
}
