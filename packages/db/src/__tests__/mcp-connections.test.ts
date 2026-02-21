/**
 * MCP connection CRUD tests — create, list, update (whitelist), delete
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockGetPool } from "./helpers.js";
import {
  createMcpConnection,
  getMcpConnections,
  updateMcpConnection,
  deleteMcpConnection,
} from "../mcp-connections.js";

vi.mock("../index.js");

describe("mcp-connections", () => {
  let query: ReturnType<typeof mockGetPool>["query"];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ query } = mockGetPool());
  });

  describe("CRUD operations", () => {
    it("createMcpConnection inserts with JSON.stringify'd config", async () => {
      const fakeConn = { id: "mcp-1", name: "slack", transport: "stdio", config: { cmd: "node" } };
      query.mockResolvedValueOnce({ rows: [fakeConn], rowCount: 1 });

      const result = await createMcpConnection({
        name: "slack",
        transport: "stdio",
        config: { cmd: "node" },
      });

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("INSERT INTO mcp_connections");
      expect(sql).toContain("RETURNING *");
      expect(params).toEqual(["slack", "stdio", JSON.stringify({ cmd: "node" })]);
      expect(result).toEqual(fakeConn);
    });

    it("deleteMcpConnection deletes by id", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await deleteMcpConnection("mcp-1");

      expect(query).toHaveBeenCalledOnce();
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("DELETE FROM mcp_connections WHERE id = $1");
      expect(params).toEqual(["mcp-1"]);
    });
  });

  describe("getMcpConnections()", () => {
    it("only returns enabled connections", async () => {
      query.mockResolvedValueOnce({
        rows: [{ id: "mcp-1", name: "slack", enabled: true }],
        rowCount: 1,
      });

      await getMcpConnections();

      expect(query).toHaveBeenCalledOnce();
      const [sql] = query.mock.calls[0];
      expect(sql).toContain("WHERE enabled = true");
      expect(sql).toContain("ORDER BY name");
    });
  });

  describe("updateMcpConnection()", () => {
    it("column whitelist rejects unknown fields", async () => {
      // When no valid entries, falls back to SELECT by id
      query.mockResolvedValueOnce({
        rows: [{ id: "mcp-1", name: "slack" }],
        rowCount: 1,
      });

      const result = await updateMcpConnection("mcp-1", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["evil_column" as any]: "bad",
      } as never);

      expect(query).toHaveBeenCalledOnce();
      const [sql] = query.mock.calls[0];
      expect(sql).toContain("SELECT * FROM mcp_connections WHERE id = $1");
      expect(sql).not.toContain("UPDATE");
      expect(result).toEqual({ id: "mcp-1", name: "slack" });
    });

    it("accepts valid columns and builds SET clause", async () => {
      query.mockResolvedValueOnce({
        rows: [{ id: "mcp-1", name: "updated-slack", enabled: false }],
        rowCount: 1,
      });

      await updateMcpConnection("mcp-1", { name: "updated-slack", enabled: false });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("UPDATE mcp_connections SET");
      expect(sql).toContain('"name" = $2');
      expect(sql).toContain('"enabled" = $3');
      expect(sql).toContain("WHERE id = $1");
      expect(params).toEqual(["mcp-1", "updated-slack", false]);
    });
  });
});
