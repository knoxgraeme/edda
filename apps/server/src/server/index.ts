/**
 * HTTP server — health check + streaming chat endpoint
 */

import { randomUUID, timingSafeEqual } from "crypto";
import { stripReasoningContent } from "../utils/strip-reasoning.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import {
  getPool,
  listThreads,
  upsertThread,
  setThreadTitle,
  searchItems,
  getAgentByName,
  createTaskRun,
  getSettingsSync,
  refreshSettings,
} from "@edda/db";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getSharedCheckpointer } from "../checkpointer.js";
import { embed } from "../embed.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { getLogger, withTraceId } from "../logger.js";
import { invalidateMCPClient, ssrfSafeFetch } from "../mcp/client.js";
import { MCPOAuthProvider } from "../mcp/oauth-provider.js";
import {
  getMcpConnectionById,
  updateMcpConnection,
  upsertOAuthState,
  getOAuthState,
  decrypt,
} from "@edda/db";
import { resolveThreadId } from "../agent/build-agent.js";
import { getOrBuildAgent, invalidateAllAgents } from "../agent/agent-cache.js";
import { executeAgentRun } from "../agent/run-execution.js";
import { deliverRunResults } from "../utils/notify.js";
import { runWithConcurrencyLimit } from "../utils/semaphore.js";
import { getAdapter } from "../channels/deliver.js";
import { resolveAndNotify } from "../agent/resolve-action.js";
import { runCronTick } from "../cron.js";

const StreamRequestSchema = z.object({
  messages: z.array(z.object({ content: z.string().min(1) })).min(1),
  thread_id: z
    .string()
    .max(200)
    .regex(/^[a-zA-Z0-9_:-]+$/)
    .optional(),
  agent_name: z.string().min(1),
});

function setCors(res: ServerResponse) {
  const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Validate the Authorization bearer token against INTERNAL_API_SECRET.
 * Health endpoint is always unauthenticated.
 */
function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const secret = process.env.INTERNAL_API_SECRET!;

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

function handleHealth(res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
}

async function handleReady(res: ServerResponse) {
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
  } catch (err) {
    getLogger().error({ err }, "Readiness check failed");
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", error: "Database unavailable" }));
  }
}

async function handleStream(req: IncomingMessage, res: ServerResponse) {
  return withTraceId({ module: "stream" }, async () => {
    try {
      const raw = await readBody(req);
      const parsed = StreamRequestSchema.safeParse(JSON.parse(raw));

      if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parsed.error.issues[0].message }));
        return;
      }

      const { messages, agent_name } = parsed.data;
      const userContent = messages[messages.length - 1].content;

      const state = await getOrBuildAgent(agent_name);
      if (!state) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Agent "${agent_name}" not found or disabled` }));
        return;
      }

      // Resolve thread ID: use provided or resolve from agent config
      const thread_id = parsed.data.thread_id
        ? parsed.data.thread_id
        : resolveThreadId(
            state.agentRow,
            { platform: "web", external_id: "default" },
            { timezone: getSettingsSync().user_timezone },
          );

      // Ensure thread exists and set title from first message
      upsertThread(thread_id, agent_name)
        .then(() => {
          const title = userContent.length > 80 ? userContent.slice(0, 77) + "..." : userContent;
          return setThreadTitle(thread_id, title);
        })
        .catch((err) =>
          getLogger().error({ err, threadId: thread_id }, "Failed to set thread title"),
        );

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Emit resolved thread_id as initial SSE event
      res.write(`data: ${JSON.stringify({ thread_id })}\n\n`);

      const stream = state.agent.streamEvents(
        { messages: [new HumanMessage(userContent)] },
        {
          configurable: {
            thread_id,
            agent_name: state.agentName,
            retrieval_context: state.retrievalContext,
          },
          version: "v2",
        },
      );

      // Track reasoning block state across chunks (e.g. <think>/<thinking> from Minimax, DeepSeek, Anthropic)
      let insideThinkBlock = false;
      let activeCloseTag: string | undefined;

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

          // Strip reasoning blocks that span across streaming chunks
          ({ content, insideThinkBlock, activeCloseTag } = stripReasoningContent(content, insideThinkBlock, activeCloseTag));

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

          const data = JSON.stringify([
            "messages",
            [plain, { langgraph_node: event.metadata?.langgraph_node }],
          ]);
          res.write(`data: ${data}\n\n`);
        } else if (event.event === "on_tool_end") {
          const output = event.data?.output;
          if (!output) continue;

          const plain = {
            id: output.id ?? event.run_id,
            type: "tool",
            content:
              typeof output.content === "string" ? output.content : JSON.stringify(output.content),
            tool_call_id: output.tool_call_id,
            name: output.name,
          };

          const data = JSON.stringify([
            "messages",
            [plain, { langgraph_node: event.metadata?.langgraph_node }],
          ]);
          res.write(`data: ${data}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      getLogger().error({ err }, "Stream error");
      const errStr = String(err);
      const userMessage = errStr.includes("overloaded")
        ? "The AI service is temporarily overloaded. Please try again in a moment."
        : errStr.includes("input_schema")
          ? "A tool has an invalid schema configuration. Check MCP connections."
          : "An error occurred while processing your request. Please try again.";
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: userMessage }));
      } else {
        res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
        res.end();
      }
    }
  });
}

async function handleThreadList(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const agentName = url.searchParams.get("agent_name") ?? undefined;
    const rows = await listThreads(50, agentName);
    const threads = rows.map((r) => ({
      id: r.thread_id,
      title: r.title || "Untitled",
      updatedAt: r.updated_at,
      status: "idle",
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(threads));
  } catch (err) {
    getLogger().error({ err }, "Thread list error");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

async function handleAgentThread(agentName: string, res: ServerResponse) {
  try {
    const agentRow = await getAgentByName(agentName);
    if (!agentRow) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Agent "${agentName}" not found` }));
      return;
    }
    if (!agentRow.enabled) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Agent "${agentName}" is disabled` }));
      return;
    }

    const thread_id = resolveThreadId(
      agentRow,
      { platform: "web", external_id: "default" },
      { timezone: getSettingsSync().user_timezone },
    );
    await upsertThread(thread_id, agentName);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ thread_id }));
  } catch (err) {
    getLogger().error({ err, agent: agentName }, "Agent thread error");
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
      const msgType = String(typeof m._getType === "function" ? m._getType() : (m.type ?? "ai"));
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
    getLogger().error({ err, threadId }, "Thread detail error");
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

    // Validate completion_secret against stored (encrypted) value (per-flow auth)
    const oauthState = await getOAuthState(body.connection_id);
    if (!oauthState?.pending_auth?.completion_secret) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No pending auth found" }));
      return;
    }
    let storedSecret: string;
    try {
      storedSecret = decrypt(oauthState.pending_auth.completion_secret);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No pending auth found" }));
      return;
    }
    const expectedBuf = Buffer.from(storedSecret);
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
    await auth(provider, {
      serverUrl: new URL(serverUrl),
      authorizationCode: body.code,
      fetchFn: ssrfSafeFetch,
    });

    // Update connection status
    await updateMcpConnection(body.connection_id, {
      auth_status: "active",
    } as Parameters<typeof updateMcpConnection>[1]);

    // Invalidate MCP client so next loadMCPTools() picks up the auth
    await invalidateMCPClient();
    invalidateAllAgents();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    getLogger().error({ err, connectionId }, "MCP OAuth token exchange failed");

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
    getLogger().error({ err }, "Search error");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Search failed" }));
  }
}

async function handleChannelWebhook(platform: string, req: IncomingMessage, res: ServerResponse) {
  const adapter = getAdapter(platform);
  if (!adapter?.handleWebhook) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No webhook handler for platform "${platform}"` }));
    return;
  }
  await adapter.handleWebhook(req, res);
}

const AgentRunRequestSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  notify: z.array(z.string().min(1).max(200)).max(20).default(["inbox"]),
});

async function handleAgentRun(agentName: string, req: IncomingMessage, res: ServerResponse) {
  let body: z.infer<typeof AgentRunRequestSchema>;
  try {
    const raw = await readBody(req);
    const parsed = AgentRunRequestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsed.error.issues[0].message }));
      return;
    }
    body = parsed.data;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const agentDef = await getAgentByName(agentName);
  if (!agentDef) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Agent "${agentName}" not found` }));
    return;
  }
  if (!agentDef.enabled) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Agent "${agentName}" is disabled` }));
    return;
  }

  const settings = await refreshSettings();
  const modelName = agentDef.model || settings.default_model;

  // Force ephemeral thread — manual runs always get a fresh thread
  const threadId = resolveThreadId({ ...agentDef, thread_lifetime: "ephemeral" }, undefined, {
    timezone: settings.user_timezone,
  });

  const run = await createTaskRun({
    agent_id: agentDef.id,
    agent_name: agentDef.name,
    trigger: "user",
    thread_id: threadId,
    model: modelName,
  });

  // Return immediately — execute async
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ run_id: run.id }));

  // Execute in background with concurrency limit
  const deliverParams = {
    agentId: agentDef.id,
    agentName: agentDef.name,
    runId: run.id,
    targets: body.notify,
    sourceType: "system" as const,
    sourceId: run.id,
  };

  runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
    try {
      const lastMessage = await executeAgentRun({
        agentDef,
        runId: run.id,
        threadId,
        prompt: body.prompt,
        trigger: "manual",
      });
      await deliverRunResults({ ...deliverParams, lastMessage });
    } catch (err) {
      // executeAgentRun already recorded the failure — just notify
      await deliverRunResults({ ...deliverParams, lastMessage: undefined, error: err });
    }
  }).catch((err) => {
    getLogger().error({ agent: agentDef.name, err }, "Agent run concurrency error");
  });
}

const ResolveActionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  resolved_by: z.string().default("web"),
});

/**
 * POST /api/cron/tick — external cron runner entry point.
 *
 * Drains due reminders, fires due schedules, and runs maintenance in one
 * atomic pass. Auth'd with INTERNAL_API_SECRET. Safe to call in any mode:
 * in `in_process` mode the CAS guards on reminders and schedules prevent
 * double-fire if both this endpoint and the LocalCronRunner tick in the
 * same second.
 *
 * Use from:
 *   - Railway Cron Jobs → `node apps/server/dist/cron-client.js`
 *   - pg_cron → pg_net HTTP post (see migration 014)
 *   - GitHub Actions / Cloud Scheduler / Fly machine cron
 *   - Manual curl for debugging
 */
async function handleCronTick(res: ServerResponse) {
  try {
    const result = await runCronTick();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    getLogger().error({ err }, "Cron tick failed");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Cron tick failed" }));
  }
}

async function handleResolveAction(actionId: string, req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const parsed = ResolveActionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsed.error.issues[0].message }));
      return;
    }

    const result = await resolveAndNotify(actionId, parsed.data.decision, parsed.data.resolved_by);
    if (!result) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Action already resolved" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ action: result.action, tool_result: result.toolResult ?? null }));
  } catch (err) {
    getLogger().error({ err, actionId }, "Failed to resolve pending action");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to resolve action" }));
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
    const urlPath = url.split("?")[0];
    const threadDetailMatch = urlPath.match(/^\/api\/threads\/([^/]+)$/);
    const agentThreadMatch = urlPath.match(/^\/api\/agents\/([^/]+)\/thread$/);
    const agentRunMatch = urlPath.match(/^\/api\/agents\/([^/]+)\/run$/);
    const channelWebhookMatch = urlPath.match(/^\/api\/channels\/(\w+)\/webhook$/);
    const resolveActionMatch = urlPath.match(
      /^\/api\/pending-actions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resolve$/i,
    );

    // Unauthenticated endpoints (own auth or public)
    if (urlPath === "/api/health" && req.method === "GET") {
      handleHealth(res);
      return;
    }
    if (urlPath === "/api/ready" && req.method === "GET") {
      await handleReady(res);
      return;
    }
    // Dynamic channel webhook route — adapters handle their own auth
    if (channelWebhookMatch && req.method === "POST") {
      await handleChannelWebhook(channelWebhookMatch[1], req, res);
      return;
    }
    // Backward-compatible alias for Telegram webhook
    if (urlPath === "/api/telegram/webhook" && req.method === "POST") {
      await handleChannelWebhook("telegram", req, res);
      return;
    }

    // All other endpoints require auth when INTERNAL_API_SECRET is set
    if (!checkAuth(req, res)) return;

    if (urlPath === "/api/stream" && req.method === "POST") {
      await handleStream(req, res);
    } else if (urlPath === "/api/cron/tick" && req.method === "POST") {
      await handleCronTick(res);
    } else if (urlPath === "/api/threads" && req.method === "GET") {
      await handleThreadList(req, res);
    } else if (threadDetailMatch && req.method === "GET") {
      await handleThreadDetail(threadDetailMatch[1], res);
    } else if (agentThreadMatch && req.method === "GET") {
      await handleAgentThread(decodeURIComponent(agentThreadMatch[1]), res);
    } else if (agentRunMatch && req.method === "POST") {
      await handleAgentRun(decodeURIComponent(agentRunMatch[1]), req, res);
    } else if (urlPath === "/api/search/items" && req.method === "POST") {
      await handleSearchItems(req, res);
    } else if (resolveActionMatch && req.method === "POST") {
      await handleResolveAction(resolveActionMatch[1], req, res);
    } else if (urlPath === "/internal/mcp-oauth/complete" && req.method === "POST") {
      await handleMcpOAuthComplete(req, res);
    } else if (urlPath === "/internal/mcp-invalidate" && req.method === "POST") {
      await invalidateMCPClient();
      invalidateAllAgents();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve());
  });
}
