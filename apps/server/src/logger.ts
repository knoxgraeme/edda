/**
 * Structured logger — Pino-based with AsyncLocalStorage trace context.
 *
 * Usage:
 *   import { getLogger, withTraceId } from "./logger.js";
 *
 *   // In an entry point (HTTP handler, cron job, webhook):
 *   await withTraceId({ module: "cron", agent: "digest" }, async () => {
 *     const log = getLogger();
 *     log.info({ schedule: "daily_digest" }, "Executing schedule");
 *   });
 *
 *   // Anywhere deeper in the call stack:
 *   const log = getLogger();
 *   log.info("This automatically includes the traceId from the entry point");
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pino, { stdSerializers } from "pino";

const VALID_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type LogLevel = (typeof VALID_LEVELS)[number];

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw && VALID_LEVELS.includes(raw as LogLevel)) return raw as LogLevel;
  return "info";
}

export const logger = pino({
  level: resolveLevel(),
  serializers: {
    err(err) {
      const serialized = stdSerializers.err(err);
      if (serialized?.message) {
        serialized.message = serialized.message
          .replace(/(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s]+/gi, '[redacted-url]')
          .replace(/sk-[a-zA-Z0-9]{20,}/g, '[redacted-key]');
      }
      return serialized;
    },
  },
  ...(process.env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

type Logger = pino.Logger;

const als = new AsyncLocalStorage<Logger>();

/**
 * Return the contextual logger (with traceId + bindings) if inside a
 * withTraceId() scope, otherwise the base logger.
 */
export function getLogger(): Logger {
  return als.getStore() ?? logger;
}

/**
 * Run `fn` with a child logger bound to a new traceId and any extra bindings.
 * All getLogger() calls inside `fn` (including async descendants) will
 * return this child logger.
 */
export async function withTraceId<T>(
  bindings: Record<string, unknown>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const child = logger.child({ traceId: randomUUID(), ...bindings });
  return als.run(child, fn);
}
