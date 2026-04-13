/**
 * Commander `.action()` wrapper that centralises error handling and
 * DB pool cleanup. Every Phase 2+ command wraps its handler in
 * `runAction()` so errors are rendered consistently and the process
 * exits cleanly when the command is done.
 */

import chalk from "chalk";
import { closeDb } from "./db.js";
import { BackendError } from "./backend.js";

export function runAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof BackendError) {
        console.error(chalk.red(err.message));
      } else if (err instanceof Error) {
        console.error(chalk.red(err.message));
      } else {
        console.error(chalk.red(String(err)));
      }
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  };
}
