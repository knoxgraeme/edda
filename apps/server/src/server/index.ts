/**
 * HTTP server — health check + streaming chat endpoint
 */

import { randomUUID, timingSafeEqual } from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import {
  getPool,
  listThreads,
  upsertThread,
  setThreadTitle,
  searchItems,
  getAgentByName,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import type { RetrievalContext, Agent } from "@edda/db";
import { HumanMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { getSharedCheckpointer } from "../checkpointer/index.js";
import { embed } from "../embed/index.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { getLogger, withTraceId } from "../logger.js";
import { invalidateMCPClient, ssrfSafeFetch } from "../agent/mcp.js";
import { MCPOAuthProvider } from "../agent/mcp-oauth-provider.js";
import { getMcpConnectionById, updateMcpConnection, upsertOAuthState, getOAuthState, decrypt } from "@edda/db";
import { handleWebhookUpdate, validateWebhookSecret } from "../channels/telegram.js";
import { buildAgent, resolveThreadId } from "../agent/build-agent.js";
import { deliverRunResults } from "../utils/notify.js";
import { resolveRetrievalContext, extractLastAssistantMessage } from "../agent/tool-helpers.js";
import { sanitizeError } from "../utils/sanitize-error.js";
import { withTimeout } from "../utils/with-timeout.js";
import { runWithConcurrencyLimit } from "../utils/semaphore.js";
import type { Update } from "grammy/types";

interface AgentState {
  agent: Runnable;
  agentName: string;
  agentRow?: Agent;
  retrievalContext?: RetrievalContext;
}

interface CachedAgent {
  state: AgentState;
  cachedAt: number;
}

interface AgentResult {
  messages?: Array<{
    role?: string;
    content?: unknown;
    _getType?: () => string;
  }>;
}

const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const agentCache = new Map<string, CachedAgent>();
const buildLocks = new Map<string, Promise<AgentState | null>>();
let defaultAgentName: string | null = null;

async function getOrBuildAgent(name: string): Promise<AgentState | null> {
  const cached = agentCache.get(name);
  if (cached && Date.now() - cached.cachedAt < AGENT_CACHE_TTL_MS) return cached.state;

  // Coalesce concurrent builds for the same agent
  const existing = buildLocks.get(name);
  if (existing) return existing;

  const buildPromise = (async (): Promise<AgentState | null> => {
    try {
      const agentRow = await getAgentByName(name);
      if (!agentRow) return null;

      const agent = await buildAgent(agentRow);
      const state: AgentState = {
        agent,
        agentName: agentRow.name,
        agentRow,
        retrievalContext: resolveRetrievalContext(agentRow.metadata, agentRow.name),
      };
      agentCache.set(name, { state, cachedAt: Date.now() });
      return state;
    } finally {
      buildLocks.delete(name);
    }
  })();

  buildLocks.set(name, buildPromise);
  return buildPromise;
}

export function setAgent(
  agent: Runnable,
  opts: { agentName: string; retrievalContext?: RetrievalContext },
) {
  const state: AgentState = { agent, ...opts };
  agentCache.set(opts.agentName, { state, cachedAt: Date.now() });
  defaultAgentName = opts.agentName;
}

/**
 * Rebuild the default chat agent from the DB. Call after tool/skill/config
 * changes so the streaming endpoint picks up the new agent definition
 * without a server restart.
 */
export async function rebuildDefaultAgent(): Promise<void> {
  if (!defaultAgentName) return; // not initialized yet

  // Invalidate cached entry so it's rebuilt on next request
  agentCache.delete(defaultAgentName);

  const rebuilt = await getOrBuildAgent(defaultAgentName);
  if (!rebuilt) {
    getLogger().warn({ agent: defaultAgentName }, "Agent not found — skipping rebuild");
    return;
  }
  getLogger().info({ agent: defaultAgentName }, "Default agent rebuilt");
}

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
    getLogger().error({ err }, "Health check failed");
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", error: "Health check failed" }));
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
        res.end(JSON.stringify({ error: `Agent "${agent_name}" not found` }));
        return;
      }

      // Resolve thread ID: use provided or resolve from agent config
      const thread_id = parsed.data.thread_id
        ? parsed.data.thread_id
        : state.agentRow
          ? resolveThreadId(state.agentRow, { platform: "web", external_id: "default" })
          : randomUUID();

      // Ensure thread exists and set title from first message
      upsertThread(thread_id, agent_name)
        .then(() => {
          const title = userContent.length > 80 ? userContent.slice(0, 77) + "..." : userContent;
          return setThreadTitle(thread_id, title);
        })
        .catch((err) => getLogger().error({ err, threadId: thread_id }, "Failed to set thread title"));

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
      getLogger().error({ err }, "Stream error");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
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

    const thread_id = resolveThreadId(agentRow, { platform: "web", external_id: "default" });
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

async function handleTelegramWebhook(req: IncomingMessage, res: ServerResponse) {
  // Validate secret token — reuses INTERNAL_API_SECRET (set as secret_token during webhook registration)
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    // No secret configured — reject all webhook requests (Telegram should not be enabled without it)
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Webhook authentication not configured" }));
    return;
  }
  const headerSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;
  if (!validateWebhookSecret(headerSecret, secret)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid secret token" }));
    return;
  }

  let update: Update;
  try {
    const raw = await readBody(req);
    update = JSON.parse(raw);
  } catch (err) {
    getLogger().error({ err }, "Failed to parse Telegram webhook body");
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request body" }));
    return;
  }

  // Process asynchronously — always return 200 for valid Telegram updates
  handleWebhookUpdate(update).catch((err) => {
    getLogger().error({ err }, "Telegram webhook update processing failed");
  });

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Execute an agent run: build agent, invoke with prompt, track task_run lifecycle.
 * Shared execution logic used by handleAgentRun (and potentially cron).
 */
export async function executeAgentRun(opts: {
  agentDef: Agent;
  runId: string;
  threadId: string;
  prompt: string;
  trigger: string;
}): Promise<string | undefined> {
  const { agentDef, runId, threadId, prompt, trigger } = opts;
  return withTraceId({ module: "run", agent: agentDef.name, runId, trigger }, async () => {
    const startTime = Date.now();
    try {
      await startTaskRun(runId);
      getLogger().info({ agent: agentDef.name, runId, trigger }, "Executing agent run");

      const agent = await buildAgent(agentDef);
      const result: AgentResult = await withTimeout(
        agent.invoke(
          { messages: [{ role: "user", content: prompt }] },
          {
            configurable: {
              thread_id: threadId,
              agent_name: agentDef.name,
              retrieval_context: resolveRetrievalContext(agentDef.metadata, agentDef.name),
            },
          },
        ),
        AGENT_TIMEOUT_MS,
        agentDef.name,
      );

      const duration = Date.now() - startTime;
      const lastMessage = extractLastAssistantMessage(result);
      await completeTaskRun(runId, {
        output_summary: lastMessage?.slice(0, 500),
        duration_ms: duration,
      });
      getLogger().info({ agent: agentDef.name, runId, durationMs: duration }, "Agent run completed");
      return lastMessage;
    } catch (err) {
      getLogger().error({ agent: agentDef.name, runId, err }, "Agent run failed");
      await failTaskRun(runId, sanitizeError(err)).catch((dbErr) =>
        getLogger().error({ runId, err: dbErr }, "Failed to record task_run failure"),
      );
      throw err;
    }
  });
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
  const threadId = resolveThreadId({ ...agentDef, thread_lifetime: "ephemeral" });

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

    // Unauthenticated endpoints (own auth or public)
    if (urlPath === "/api/health" && req.method === "GET") {
      await handleHealth(res);
      return;
    }
    if (urlPath === "/api/telegram/webhook" && req.method === "POST") {
      await handleTelegramWebhook(req, res);
      return;
    }

    // All other endpoints require auth when INTERNAL_API_SECRET is set
    if (!checkAuth(req, res)) return;

    if (urlPath === "/api/stream" && req.method === "POST") {
      await handleStream(req, res);
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
    } else if (urlPath === "/internal/mcp-oauth/complete" && req.method === "POST") {
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
