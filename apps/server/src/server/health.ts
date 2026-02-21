/**
 * HTTP server — health check + streaming chat endpoint
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { getPool } from "@edda/db";
import { HumanMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";

let agent: Runnable | null = null;

export function setAgent(a: Runnable) {
  agent = a;
}

const StreamRequestSchema = z.object({
  messages: z.array(z.object({ content: z.string().min(1) })).min(1),
  thread_id: z.string().uuid(),
});

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
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
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", error: String(err) }));
  }
}

async function handleStream(req: IncomingMessage, res: ServerResponse) {
  if (!agent) {
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

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const stream = agent.streamEvents(
      { messages: [new HumanMessage(userContent)] },
      { configurable: { thread_id }, version: "v2" },
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
      res.end(JSON.stringify({ error: String(err) }));
    } else {
      res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
      res.end();
    }
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

    if (req.url === "/api/health" && req.method === "GET") {
      await handleHealth(res);
    } else if (req.url === "/api/stream" && req.method === "POST") {
      await handleStream(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve());
  });
}
