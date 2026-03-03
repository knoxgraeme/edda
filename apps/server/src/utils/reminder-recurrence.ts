/**
 * Recurrence utilities for scheduled reminders.
 *
 * Supports two formats:
 *   - cron: 5 space-separated fields (minute hour day month weekday)
 *   - interval: PostgreSQL interval string (e.g. '1 hour', '30 minutes', '2 days')
 */

import { CronExpressionParser } from "cron-parser";

export type RecurrenceFormat = "cron" | "interval";

const INTERVAL_RE = /^\d+\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)$/i;

const UNIT_TO_MINUTES: Record<string, number> = {
  second: 1 / 60,
  seconds: 1 / 60,
  minute: 1,
  minutes: 1,
  hour: 60,
  hours: 60,
  day: 1440,
  days: 1440,
  week: 10080,
  weeks: 10080,
  month: 43200,
  months: 43200,
  year: 525600,
  years: 525600,
};

const MIN_INTERVAL_MINUTES = 5;

/**
 * Detect whether a recurrence string is a cron expression or an interval.
 * Cron expressions have exactly 5 space-separated fields where the first
 * field looks like a cron token (digits, *, commas, dashes, slashes).
 */
export function detectRecurrenceFormat(recurrence: string): RecurrenceFormat {
  const parts = recurrence.trim().split(/\s+/);
  if (parts.length === 5 && /^[\d*,\-/]+$/.test(parts[0])) return "cron";
  return "interval";
}

/**
 * Validate a recurrence string. Returns null if valid, error message if invalid.
 */
export function validateRecurrence(recurrence: string): string | null {
  const format = detectRecurrenceFormat(recurrence);
  if (format === "cron") {
    try {
      CronExpressionParser.parse(recurrence);
      return null;
    } catch (err) {
      return `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  const trimmed = recurrence.trim();
  if (!trimmed) return "Recurrence string cannot be empty";
  if (!INTERVAL_RE.test(trimmed)) {
    return `Invalid interval: expected "<number> <unit>" (e.g. "30 minutes", "2 hours"), got "${trimmed}"`;
  }
  const [valueStr, unit] = trimmed.split(/\s+/);
  const value = Number(valueStr);
  const multiplier = UNIT_TO_MINUTES[unit.toLowerCase()];
  if (multiplier !== undefined && value * multiplier < MIN_INTERVAL_MINUTES) {
    return `Interval too short: minimum is ${MIN_INTERVAL_MINUTES} minutes`;
  }
  return null;
}

/**
 * Get the next fire date from a cron expression.
 * When timezone is provided, cron fields are interpreted in that timezone.
 */
export function getNextCronDate(expr: string, after?: Date, timezone?: string): Date {
  const cron = CronExpressionParser.parse(expr, {
    currentDate: after ?? new Date(),
    ...(timezone && { tz: timezone }),
  });
  return cron.next().toDate();
}
