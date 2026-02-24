/**
 * Concurrency semaphore for limiting parallel channel-agent execution.
 */

import { Semaphore } from "async-mutex";

let _semaphore: Semaphore | null = null;

export function getTaskSemaphore(maxConcurrency: number): Semaphore {
  if (!_semaphore || _semaphore.getValue() !== maxConcurrency) {
    _semaphore = new Semaphore(maxConcurrency);
  }
  return _semaphore;
}

export async function runWithConcurrencyLimit<T>(
  maxConcurrency: number,
  fn: () => Promise<T>,
): Promise<T> {
  const sem = getTaskSemaphore(maxConcurrency);
  const [, release] = await sem.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
