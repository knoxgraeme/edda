/**
 * Minimal cron utilities for the web UI.
 *
 * Handles the 5-field cron expressions the agent scheduler uses
 * (minute hour day-of-month month day-of-week).
 *
 * `humanizeCron` produces a short human-readable string for common
 * patterns and falls back to the raw expression for anything exotic.
 *
 * `nextRunAt` computes the next firing timestamp. Pure client-side,
 * no `cron-parser` dependency — we iterate forward minute-by-minute
 * up to a bounded horizon, which is fast enough for display.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface ParsedCron {
  minutes: Set<number> | "*";
  hours: Set<number> | "*";
  daysOfMonth: Set<number> | "*";
  months: Set<number> | "*";
  daysOfWeek: Set<number> | "*";
}

function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | "*" {
  if (field === "*") return "*";
  const out = new Set<number>();
  for (const part of field.split(",")) {
    // Handle step values: */5, 1-10/2
    const [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`Invalid step: ${part}`);
    }

    let start: number;
    let end: number;
    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [s, e] = range.split("-").map((n) => parseInt(n, 10));
      if (!Number.isFinite(s) || !Number.isFinite(e)) {
        throw new Error(`Invalid range: ${range}`);
      }
      start = s;
      end = e;
    } else {
      const v = parseInt(range, 10);
      if (!Number.isFinite(v)) throw new Error(`Invalid value: ${range}`);
      if (stepStr) {
        start = v;
        end = max;
      } else {
        start = v;
        end = v;
      }
    }
    if (start < min || end > max || start > end) {
      throw new Error(`Out-of-range field: ${part}`);
    }
    for (let v = start; v <= end; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    return {
      minutes: parseField(parts[0], 0, 59),
      hours: parseField(parts[1], 0, 23),
      daysOfMonth: parseField(parts[2], 1, 31),
      months: parseField(parts[3], 1, 12),
      daysOfWeek: parseField(parts[4], 0, 6),
    };
  } catch {
    return null;
  }
}

/** Format hour/minute as "3:00 AM". */
function formatTime(hour: number, minute: number): string {
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const period = hour < 12 ? "AM" : "PM";
  const mm = minute.toString().padStart(2, "0");
  return `${h12}:${mm} ${period}`;
}

/**
 * Produce a human-readable description of a cron expression.
 * Handles daily, weekly, hourly, every-N-hours, and monthly patterns.
 * Returns the raw expression for anything we don't specialize.
 */
export function humanizeCron(expression: string): string {
  const parsed = parseCron(expression);
  if (!parsed) return expression;

  const { minutes, hours, daysOfMonth, months, daysOfWeek } = parsed;

  // Single specific minute + single specific hour is the common case.
  const singleMinute = minutes !== "*" && minutes.size === 1;
  const singleHour = hours !== "*" && hours.size === 1;
  const hour = singleHour ? [...(hours as Set<number>)][0] : null;
  const minute = singleMinute ? [...(minutes as Set<number>)][0] : null;

  const allHours = hours !== "*" && hours.size === 24;
  const anyDay = daysOfMonth === "*";
  const anyMonth = months === "*";
  const anyDow = daysOfWeek === "*";

  // Every N minutes
  if (allHours && anyDay && anyMonth && anyDow && minutes !== "*") {
    if (minutes.size === 60) return "Every minute";
    if (minutes.size === 1 && minute === 0) return "Every hour";
    // Detect stride (e.g., */15)
    const sorted = [...minutes].sort((a, b) => a - b);
    if (sorted.length >= 2) {
      const step = sorted[1] - sorted[0];
      if (sorted.every((v, i) => v === i * step)) {
        return `Every ${step} minutes`;
      }
    }
  }

  // Every N hours, on the minute
  if (singleMinute && minute === 0 && anyDay && anyMonth && anyDow && hours !== "*") {
    if (allHours) return "Every hour";
    const sorted = [...hours].sort((a, b) => a - b);
    if (sorted.length >= 2) {
      const step = sorted[1] - sorted[0];
      if (sorted.every((v, i) => v === i * step)) {
        return `Every ${step} hours`;
      }
    }
  }

  // Daily at fixed time
  if (singleMinute && singleHour && anyDay && anyMonth && anyDow) {
    return `Daily at ${formatTime(hour!, minute!)}`;
  }

  // Weekly at fixed time — specific weekday(s)
  if (
    singleMinute &&
    singleHour &&
    anyDay &&
    anyMonth &&
    daysOfWeek !== "*"
  ) {
    const days = [...daysOfWeek].sort((a, b) => a - b);
    if (days.length === 1) {
      return `${WEEKDAYS_LONG[days[0]]} at ${formatTime(hour!, minute!)}`;
    }
    if (days.length === 5 && days.every((d, i) => d === i + 1)) {
      return `Weekdays at ${formatTime(hour!, minute!)}`;
    }
    if (
      days.length === 2 &&
      days[0] === 0 &&
      days[1] === 6
    ) {
      return `Weekends at ${formatTime(hour!, minute!)}`;
    }
    return `${days.map((d) => WEEKDAYS[d]).join(", ")} at ${formatTime(
      hour!,
      minute!,
    )}`;
  }

  // Monthly at fixed time — specific day of month
  if (
    singleMinute &&
    singleHour &&
    daysOfMonth !== "*" &&
    anyMonth &&
    anyDow
  ) {
    const days = [...daysOfMonth].sort((a, b) => a - b);
    if (days.length === 1) {
      const d = days[0];
      const suffix = ordinalSuffix(d);
      return `Monthly on the ${d}${suffix} at ${formatTime(hour!, minute!)}`;
    }
  }

  // Fall back to the raw expression — users who write complex crons can read them.
  return expression;
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Find the next datetime that matches the cron expression, starting
 * from `from` (exclusive). Returns null if no match in the next ~366 days.
 *
 * Implementation: step forward by minutes and check each. Bounded to
 * ~527k iterations worst case (1 year of minutes). Fast enough for UI.
 */
export function nextRunAt(
  expression: string,
  from: Date = new Date(),
): Date | null {
  const parsed = parseCron(expression);
  if (!parsed) return null;

  // Start at the next whole minute after `from`.
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const maxMinutes = 60 * 24 * 366;
  const cursor = new Date(start.getTime());
  for (let i = 0; i < maxMinutes; i++) {
    if (cronMatches(parsed, cursor)) return cursor;
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function cronMatches(parsed: ParsedCron, date: Date): boolean {
  const { minutes, hours, daysOfMonth, months, daysOfWeek } = parsed;
  if (minutes !== "*" && !minutes.has(date.getMinutes())) return false;
  if (hours !== "*" && !hours.has(date.getHours())) return false;
  // Cron semantics: if both DOM and DOW are restricted, either matching is
  // acceptable. If one is "*", only the restricted one must match.
  const dom = date.getDate();
  const dow = date.getDay();
  const mon = date.getMonth() + 1;
  if (months !== "*" && !months.has(mon)) return false;

  const domStar = daysOfMonth === "*";
  const dowStar = daysOfWeek === "*";
  if (domStar && dowStar) return true;
  if (domStar) return (daysOfWeek as Set<number>).has(dow);
  if (dowStar) return (daysOfMonth as Set<number>).has(dom);
  return (
    (daysOfMonth as Set<number>).has(dom) ||
    (daysOfWeek as Set<number>).has(dow)
  );
}

/**
 * Format a duration (ms) as a short "in 4d 6h" / "in 2h 14m" / "in 45s" string.
 * Prefers the two largest units present.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d > 0) {
    const hh = h - d * 24;
    return hh > 0 ? `in ${d}d ${hh}h` : `in ${d}d`;
  }
  if (h > 0) {
    const mm = m - h * 60;
    return mm > 0 ? `in ${h}h ${mm}m` : `in ${h}h`;
  }
  if (m > 0) {
    return `in ${m}m`;
  }
  return `in ${s}s`;
}

/** Validate that the expression parses — drop-in replacement for server isValidCron. */
export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}
