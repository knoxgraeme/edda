/**
 * HTTP server — health check + streaming chat endpoint
 */

import { randomUUID, timingSafeEqual } from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { getPool, listThreads, upsertThread, setThreadTitle, searchItems } from "@edda/db";
import type { RetrievalContext } from "@edda/db";
import { HumanMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { getSharedCheckpointer } from "../checkpointer/index.js";
import { embed } from "../embed/index.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { invalidateMCPClient, ssrfSafeFetch } from "../agent/mcp.js";
import { MCPOAuthProvider } from "../agent/mcp-oauth-provider.js";
import { getMcpConnectionById, updateMcpConnection, upsertOAuthState, getOAuthState } from "@edda/db";

interface AgentState {
  agent: Runnable;
  agentName: string;
  retrievalContext?: RetrievalContext;
}

let agentState: AgentState | null = null;

export function setAgent(
  agent: Runnable,
  opts: { agentName: string; retrievalContext?: RetrievalContext },
) {
  agentState = { agent, ...opts };
}

const StreamRequestSchema = z.object({
  messages: z.array(z.object({ content: z.string().min(1) })).min(1),
  thread_id: z.string().uuid(),
});

function setCors(res: ServerResponse) {
  const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Validate the Authorization bearer token against INTERNAL_API_SECRET.
 * If INTERNAL_API_SECRET is not set, all requests are allowed (local dev).
 * Health endpoint is always unauthenticated.
 */
function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return true;

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing Authorization header" }));
    return false;
  }

  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid token" }));
    return false;
  }

  return true;
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += (chunk as Buffer).length;
    if (totalSize > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

async function handleHealth(res: ServerResponse) {
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
  } catch (err) {
    console.error("[health] Health check failed:", err);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", error: "Health check failed" }));
  }
}

async function handleStream(req: IncomingMessage, res: ServerResponse) {
  if (!agentState) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Agent not ready" }));
    return;
  }

  try {
    const raw = await readBody(req);
    const parsed = StreamRequestSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsed.error.issues[0].message }));
      return;
    }

    const { messages, thread_id } = parsed.data;
    const userContent = messages[messages.length - 1].content;

    // Ensure thread exists and set title from first message
    upsertThread(thread_id)
      .then(() => {
        const title = userContent.length > 80 ? userContent.slice(0, 77) + "..." : userContent;
        return setThreadTitle(thread_id, title);
      })
      .catch((err) => console.error("[stream] Failed to set thread title:", err));

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const stream = agentState.agent.streamEvents(
      { messages: [new HumanMessage(userContent)] },
      {
        configurable: {
          thread_id,
          agent_name: agentState.agentName,
          retrieval_context: agentState.retrievalContext,
        },
        version: "v2",
      },
    );

    for await (const event of stream) {
      if (event.event === "on_chat_model_stream") {
        const chunk = event.data?.chunk;
        if (!chunk) continue;

        // Normalize content to string — Anthropic sends array of content blocks
        let content = "";
        if (typeof chunk.content === "string") {
          content = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          for (const block of chunk.content) {
            if (typeof block === "string") content += block;
            else if (block?.type === "text" && block.text) content += block.text;
            else if (block?.type === "text_delta" && block.text) content += block.text;
          }
        }

        const hasToolCalls = chunk.tool_calls && chunk.tool_calls.length > 0;
        if (!content && !hasToolCalls) continue;

        const plain = {
          id: chunk.id,
          type: "ai",
          content,
          tool_calls: chunk.tool_calls,
          tool_call_id: chunk.tool_call_id,
          additional_kwargs: chunk.additional_kwargs,
          name: chunk.name,
        };

        const data = JSON.stringify(["messages", [plain, { langgraph_node: event.metadata?.langgraph_node }]]);
        res.write(`data: ${data}\n\n`);
      } else if (event.event === "on_tool_end") {
        const output = event.data?.output;
        if (!output) continue;

        const plain = {
          id: output.id ?? event.run_id,
          type: "tool",
          content: typeof output.content === "string" ? output.content : JSON.stringify(output.content),
          tool_call_id: output.tool_call_id,
          name: output.name,
        };

        const data = JSON.stringify(["messages", [plain, { langgraph_node: event.metadata?.langgraph_node }]]);
        res.write(`data: ${data}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("[stream] Error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }
}

async function handleThreadList(res: ServerResponse) {
  try {
    const rows = await listThreads(50);
    const threads = rows.map((r) => ({
      id: r.thread_id,
      title: r.title || "Untitled",
      updatedAt: r.updated_at,
      status: "idle",
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(threads));
  } catch (err) {
    console.error("[threads] List error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

async function handleThreadDetail(threadId: string, res: ServerResponse) {
  try {
    const checkpointer = getSharedCheckpointer();
    if (!checkpointer) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Checkpointer not ready" }));
      return;
    }

    const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } });
    if (!tuple) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }

    const rawMessages = tuple.checkpoint?.channel_values?.messages ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (rawMessages as any[]).map((m: any) => {
      const msgType = String(
        typeof m._getType === "function" ? m._getType() : (m.type ?? "ai"),
      );
      let type: string;
      if (msgType === "human" || msgType === "HumanMessage") type = "human";
      else if (msgType === "tool" || msgType === "ToolMessage") type = "tool";
      else if (msgType === "system" || msgType === "SystemMessage") type = "system";
      else type = "ai";

      let content = m.content ?? "";
      if (typeof content !== "string" && !Array.isArray(content)) {
        content = String(content);
      }

      return {
        id: m.id ?? m.lc_id ?? randomUUID(),
        type,
        content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
        name: m.name,
      };
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(messages));
  } catch (err) {
    console.error("[threads] Detail error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

const OAuthCompleteSchema = z.object({
  connection_id: z.string().uuid(),
  code: z.string().min(1).max(2048),
  completion_secret: z.string().min(1),
});

async function handleMcpOAuthComplete(req: IncomingMessage, res: ServerResponse) {
  let connectionId: string | undefined;
  try {
    const raw = await readBody(req);
    const parsed = OAuthCompleteSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsed.error.issues[0].message }));
      return;
    }
    const body = parsed.data;
    connectionId = body.connection_id;

    // Validate completion_secret against stored value (per-flow auth)
    const oauthState = await getOAuthState(body.connection_id);
    if (!oauthState?.pending_auth?.completion_secret) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No pending auth found" }));
      return;
    }
    const expectedBuf = Buffer.from(oauthState.pending_auth.completion_secret);
    const actualBuf = Buffer.from(body.completion_secret);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid completion secret" }));
      return;
    }

    const connection = await getMcpConnectionById(body.connection_id);
    if (!connection) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Connection not found" }));
      return;
    }

    const serverUrl = (connection.config as { url?: string }).url;
    if (!serverUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Connection has no URL configured" }));
      return;
    }

    // Exchange authorization code for tokens
    const baseUrl = process.env.EDDA_BASE_URL ?? "http://localhost:3000";
    const provider = new MCPOAuthProvider(body.connection_id, baseUrl);
    await auth(provider, { serverUrl: new URL(serverUrl), authorizationCode: body.code, fetchFn: ssrfSafeFetch });

    // Update connection status
    await updateMcpConnection(body.connection_id, {
      auth_status: "active",
    } as Parameters<typeof updateMcpConnection>[1]);

    // Invalidate MCP client so next loadMCPTools() picks up the auth
    await invalidateMCPClient();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error("[mcp-oauth] Token exchange failed:", err);

    // Set error state (best-effort)
    if (connectionId) {
      await updateMcpConnection(connectionId, {
        auth_status: "error",
      } as Parameters<typeof updateMcpConnection>[1]).catch(() => {});
      await upsertOAuthState(connectionId, { pending_auth: null }).catch(() => {});
    }

    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Token exchange failed" }));
    }
  }
}

const SearchSchema = z.object({
  query: z.string().min(1),
  type: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

async function handleSearchItems(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const parsed = SearchSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsed.error.issues[0].message }));
      return;
    }

    const { query, type, limit } = parsed.data;
    const embedding = await embed(query);
    const results = await searchItems(embedding, {
      limit,
      type: type ?? undefined,
      confirmedOnly: true,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: results }));
  } catch (err) {
    console.error("[search] Error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Search failed" }));
  }
}

export async function startHealthServer(port: number): Promise<void> {
  const server = createServer(async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? "";
    const threadDetailMatch = url.match(/^\/api\/threads\/([^/]+)$/);

    // Health endpoint is always unauthenticated
    if (url === "/api/health" && req.method === "GET") {
      await handleHealth(res);
      return;
    }

    // All other endpoints require auth when INTERNAL_API_SECRET is set
    if (!checkAuth(req, res)) return;

    if (url === "/api/stream" && req.method === "POST") {
      await handleStream(req, res);
    } else if (url === "/api/threads" && req.method === "GET") {
      await handleThreadList(res);
    } else if (threadDetailMatch && req.method === "GET") {
      await handleThreadDetail(threadDetailMatch[1], res);
    } else if (url === "/api/search/items" && req.method === "POST") {
      await handleSearchItems(req, res);
    } else if (url === "/internal/mcp-oauth/complete" && req.method === "POST") {
      await handleMcpOAuthComplete(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve());
  });
}
