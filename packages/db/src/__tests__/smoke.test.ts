/**
 * Smoke tests — verify the test infrastructure works.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import { createItem, batchCreateItems } from "../items.js";

vi.mock("../index.js");

describe("test infrastructure", () => {
  let query: ReturnType<typeof mockGetPool>["query"];
  let client: ReturnType<typeof mockGetPool>["client"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query, client } = mockGetPool());
  });

  it("mockGetPool returns a usable mock", () => {
    expect(query).toBeDefined();
    expect(vi.isMockFunction(query)).toBe(true);
  });

  it("mock pool intercepts query calls from DB functions", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "test-id", type: "note", content: "hello" }],
      rowCount: 1,
    });

    const result = await createItem({ type: "note", content: "hello" });

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO items"),
      expect.any(Array),
    );
    expect(result).toEqual({ id: "test-id", type: "note", content: "hello" });
  });

  it("mock pool connect works for transaction functions", async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "1", type: "note", content: "a" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const result = await batchCreateItems([{ type: "note", content: "a" }]);

    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(result).toHaveLength(1);
    expect(client.release).toHaveBeenCalled();
  });
});
