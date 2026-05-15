import { describe, it, expect } from "vitest";
import {
  parseCron,
  humanizeCron,
  nextRunAt,
  formatCountdown,
  isValidCron,
} from "./cron.js";

// ---------------------------------------------------------------------------
// parseCron
// ---------------------------------------------------------------------------

describe("parseCron", () => {
  it("returns null for expressions with wrong field count", () => {
    expect(parseCron("* * * *")).toBeNull();
    expect(parseCron("* * * * * *")).toBeNull();
    expect(parseCron("")).toBeNull();
  });

  it("returns null for out-of-range values", () => {
    expect(parseCron("60 * * * *")).toBeNull(); // minute 60 is invalid
    expect(parseCron("* 24 * * *")).toBeNull(); // hour 24 is invalid
    expect(parseCron("* * 32 * *")).toBeNull(); // dom 32 is invalid
  });

  it("returns null for malformed step values", () => {
    expect(parseCron("*/0 * * * *")).toBeNull(); // step 0 is invalid
  });

  it("returns null for invalid range bounds", () => {
    expect(parseCron("10-5 * * * *")).toBeNull(); // start > end
  });

  it('parses wildcard fields as the string "*"', () => {
    const parsed = parseCron("* * * * *");
    expect(parsed).not.toBeNull();
    expect(parsed!.minutes).toBe("*");
    expect(parsed!.hours).toBe("*");
    expect(parsed!.daysOfMonth).toBe("*");
    expect(parsed!.months).toBe("*");
    expect(parsed!.daysOfWeek).toBe("*");
  });

  it("parses specific values into Sets", () => {
    const parsed = parseCron("0 9 * * *");
    expect(parsed).not.toBeNull();
    expect(parsed!.minutes).toEqual(new Set([0]));
    expect(parsed!.hours).toEqual(new Set([9]));
    expect(parsed!.daysOfMonth).toBe("*");
    expect(parsed!.months).toBe("*");
    expect(parsed!.daysOfWeek).toBe("*");
  });

  it("parses step values — */15 produces Set{0,15,30,45}", () => {
    const parsed = parseCron("*/15 * * * *");
    expect(parsed).not.toBeNull();
    expect(parsed!.minutes).toEqual(new Set([0, 15, 30, 45]));
    expect(parsed!.hours).toBe("*");
  });

  it("parses ranges — 9-17 produces Set{9..17}", () => {
    const parsed = parseCron("0 9-17 * * 1-5");
    expect(parsed).not.toBeNull();
    expect(parsed!.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
    expect(parsed!.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("parses comma-separated values — 0,30 produces Set{0,30}", () => {
    const parsed = parseCron("0,30 * * * *");
    expect(parsed).not.toBeNull();
    expect(parsed!.minutes).toEqual(new Set([0, 30]));
  });
});

// ---------------------------------------------------------------------------
// humanizeCron
// ---------------------------------------------------------------------------

describe("humanizeCron", () => {
  // The "Every minute" path requires minutes to be a full Set of 60 values
  // (not the wildcard "*") and hours to be a full Set of 24 values.
  it('returns "Every minute" for "0-59 0-23 * * *"', () => {
    expect(humanizeCron("0-59 0-23 * * *")).toBe("Every minute");
  });

  // "Every hour" via the allHours + singleMinute=0 path
  it('returns "Every hour" for "0 0-23 * * *"', () => {
    expect(humanizeCron("0 0-23 * * *")).toBe("Every hour");
  });

  // Step-based every-N-hours
  it('returns "Every 6 hours" for "0 */6 * * *"', () => {
    expect(humanizeCron("0 */6 * * *")).toBe("Every 6 hours");
  });

  // Daily at a fixed time
  it('returns "Daily at 9:00 AM" for "0 9 * * *"', () => {
    expect(humanizeCron("0 9 * * *")).toBe("Daily at 9:00 AM");
  });

  it('returns "Daily at 2:30 PM" for "30 14 * * *"', () => {
    expect(humanizeCron("30 14 * * *")).toBe("Daily at 2:30 PM");
  });

  it('returns "Daily at 12:00 AM" for "0 0 * * *" (midnight)', () => {
    expect(humanizeCron("0 0 * * *")).toBe("Daily at 12:00 AM");
  });

  // Weekly — specific weekday
  it('returns "Monday at 9:00 AM" for "0 9 * * 1"', () => {
    expect(humanizeCron("0 9 * * 1")).toBe("Monday at 9:00 AM");
  });

  it('returns "Weekdays at 9:00 AM" for "0 9 * * 1-5"', () => {
    expect(humanizeCron("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
  });

  it('returns "Weekends at 9:00 AM" for "0 9 * * 0,6"', () => {
    expect(humanizeCron("0 9 * * 0,6")).toBe("Weekends at 9:00 AM");
  });

  // Monthly
  it('returns "Monthly on the 1st at 9:00 AM" for "0 9 1 * *"', () => {
    expect(humanizeCron("0 9 1 * *")).toBe("Monthly on the 1st at 9:00 AM");
  });

  // Exotic / fallback — returns the raw expression unchanged
  it("returns the raw expression for invalid input", () => {
    expect(humanizeCron("not-a-cron")).toBe("not-a-cron");
    expect(humanizeCron("* * *")).toBe("* * *");
  });

  it("returns the raw expression for exotic patterns that match no named pattern", () => {
    // Wildcard hours means "every hour" but "*/15" minutes with wildcard hours
    // is exotic — no branch covers it.
    expect(humanizeCron("*/15 * * * *")).toBe("*/15 * * * *");
    // Wildcard everything — no branch covers all-wildcard
    expect(humanizeCron("* * * * *")).toBe("* * * * *");
    // Single minute but wildcard hours — doesn't hit any branch
    expect(humanizeCron("0 * * * *")).toBe("0 * * * *");
  });
});

// ---------------------------------------------------------------------------
// nextRunAt
// ---------------------------------------------------------------------------

// Helper: build a local-time Date from explicit components to avoid timezone
// ambiguity when using ISO string literals without a timezone offset.
function localDate(
  year: number,
  month: number, // 1-based
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

describe("nextRunAt", () => {
  // P1 regression: wildcard "* * * * *" should return the very next minute
  it('returns the next minute for "* * * * *"', () => {
    const from = localDate(2026, 3, 15, 8, 30, 0);
    const result = nextRunAt("* * * * *", from);
    expect(result).not.toBeNull();
    // Should be exactly 1 minute (60 000 ms) after `from`
    expect(result!.getTime()).toBe(from.getTime() + 60_000);
  });

  it('returns the next top-of-hour for "0 * * * *"', () => {
    const from = localDate(2026, 3, 15, 8, 30, 0);
    const result = nextRunAt("0 * * * *", from);
    expect(result).not.toBeNull();
    // 30 minutes ahead: 8:30 → 9:00
    expect(result!.getTime()).toBe(from.getTime() + 30 * 60_000);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getHours()).toBe(9);
  });

  it('returns 9:00 same day when from is 8:30 for "0 9 * * *"', () => {
    const from = localDate(2026, 3, 15, 8, 30, 0);
    const result = nextRunAt("0 9 * * *", from);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getDate()).toBe(15);
  });

  it('returns 9:00 next day when from is 9:30 for "0 9 * * *"', () => {
    const from = localDate(2026, 3, 15, 9, 30, 0);
    const result = nextRunAt("0 9 * * *", from);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getDate()).toBe(16);
  });

  it('returns next Monday 9am when from is a Sunday for "0 9 * * 1"', () => {
    // 2026-03-15 is a Sunday (getDay() === 0)
    const from = localDate(2026, 3, 15, 8, 30, 0);
    expect(from.getDay()).toBe(0); // guard: confirm it's Sunday
    const result = nextRunAt("0 9 * * 1", from);
    expect(result).not.toBeNull();
    expect(result!.getDay()).toBe(1); // Monday
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    // Next Monday from Mar 15 (Sun) is Mar 16
    expect(result!.getDate()).toBe(16);
    expect(result!.getMonth()).toBe(2); // 0-based: March = 2
  });

  it("returns null for an invalid expression", () => {
    expect(nextRunAt("not valid", localDate(2026, 3, 15, 8, 30))).toBeNull();
    expect(nextRunAt("* * *", new Date())).toBeNull();
  });

  it('returns a leap-year date for "0 0 29 2 *" when from is close enough', () => {
    // 2028 is a leap year; from = 2027-12-01 puts Feb 29 2028 within 366 days
    const from = localDate(2027, 12, 1, 0, 0, 0);
    const result = nextRunAt("0 0 29 2 *", from);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2028);
    expect(result!.getMonth()).toBe(1); // 0-based: February = 1
    expect(result!.getDate()).toBe(29);
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
  });

  it('returns null for "0 0 29 2 *" when no leap year falls within ~366 days', () => {
    // From 2026-03-15, the next Feb 29 is 2028-02-29 — about 716 days away
    const from = localDate(2026, 3, 15, 0, 0, 0);
    const result = nextRunAt("0 0 29 2 *", from);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatCountdown
// ---------------------------------------------------------------------------

describe("formatCountdown", () => {
  it('returns "now" for zero or negative ms', () => {
    expect(formatCountdown(0)).toBe("now");
    expect(formatCountdown(-1000)).toBe("now");
    expect(formatCountdown(-999999)).toBe("now");
  });

  it('returns seconds for sub-minute durations', () => {
    expect(formatCountdown(45000)).toBe("in 45s");
    expect(formatCountdown(1000)).toBe("in 1s");
    expect(formatCountdown(59000)).toBe("in 59s");
  });

  it('returns minutes for sub-hour durations', () => {
    expect(formatCountdown(300000)).toBe("in 5m");
    expect(formatCountdown(60000)).toBe("in 1m");
  });

  it('returns hours and minutes for multi-hour sub-day durations', () => {
    expect(formatCountdown(5400000)).toBe("in 1h 30m"); // 1.5h
  });

  it('returns just hours when minutes remainder is zero', () => {
    expect(formatCountdown(3600000)).toBe("in 1h"); // exactly 1 hour
  });

  it('returns days and hours for multi-day durations', () => {
    expect(formatCountdown(90000000)).toBe("in 1d 1h"); // 25h
  });

  it('returns just days when hour remainder is zero', () => {
    expect(formatCountdown(86400000)).toBe("in 1d"); // exactly 24h
  });
});

// ---------------------------------------------------------------------------
// isValidCron
// ---------------------------------------------------------------------------

describe("isValidCron", () => {
  it("returns true for valid 5-field expressions", () => {
    expect(isValidCron("* * * * *")).toBe(true);
    expect(isValidCron("0 9 * * *")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("0,30 * * * *")).toBe(true);
  });

  it("returns false for invalid expressions", () => {
    expect(isValidCron("not-a-cron")).toBe(false);
    expect(isValidCron("* * * *")).toBe(false);
    expect(isValidCron("* * * * * *")).toBe(false);
    expect(isValidCron("60 * * * *")).toBe(false);
    expect(isValidCron("* 24 * * *")).toBe(false);
    expect(isValidCron("*/0 * * * *")).toBe(false);
  });
});
