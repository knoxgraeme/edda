/**
 * Health check endpoint — used by Railway, Fly, Render for deploy verification
 */

import { createServer } from "http";
import { getPool } from "@edda/db";

export async function startHealthServer(port: number): Promise<void> {
  const server = createServer(async (req, res) => {
    if (req.url === "/api/health" && req.method === "GET") {
      try {
        const pool = getPool();
        await pool.query("SELECT 1");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: String(err) }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve());
  });
}
