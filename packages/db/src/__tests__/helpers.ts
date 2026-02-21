/**
 * Test helpers for @edda/db unit tests.
 *
 * Provides mock pool factories for testing query functions without a database.
 */

import { vi } from "vitest";
import { getPool } from "../connection.js";

/**
 * Creates a mock pg Pool with query and connect methods.
 * The `query` mock defaults to returning `{ rows: [], rowCount: 0 }`.
 *
 * `connect` returns a mock client for transaction testing (batchCreateItems, etc.).
 * The client has its own `query` mock + a `release` spy.
 */
export function createMockPool() {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockRelease = vi.fn();

  const mockClient = {
    query: mockClientQuery,
    release: mockRelease,
  };

  const mockConnect = vi.fn().mockResolvedValue(mockClient);

  const mockPool = {
    query: mockQuery,
    connect: mockConnect,
    end: vi.fn(),
  };

  return { pool: mockPool, query: mockQuery, connect: mockConnect, client: mockClient };
}

/** Mocks `getPool()` to return a fake pool. Call in `beforeEach`. */
export function mockGetPool() {
  const mock = createMockPool();
  vi.mocked(getPool).mockReturnValue(mock.pool as unknown as ReturnType<typeof getPool>);
  return mock;
}
