/** Strip connection strings, file paths, API keys, and stack traces from error messages. */
export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
  return raw
    .replace(/(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/\/(?:Users|home|var|tmp|opt|etc)\/[^\s:]+/g, "[redacted-path]")
    .replace(/sk-[a-zA-Z0-9]+/g, "[redacted-key]")
    .replace(/\bat\s+\S+\s+\(.*\)/g, "")
    .slice(0, 200);
}
