/**
 * Timezone helpers for validating and formatting user-configured IANA values.
 */

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function formatDateInTimezoneOrUtc(now: Date, timezone?: string): string {
  if (!timezone) return now.toISOString().split("T")[0];
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().split("T")[0];
  }
}
