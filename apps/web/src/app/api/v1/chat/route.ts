import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, badRequest } from "../_lib/helpers";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8000";

const ChatSchema = z.object({
  message: z.string().min(1).max(50_000),
  thread_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = ChatSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const res = await fetch(`${SERVER_URL}/api/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ content: parsed.data.message }],
      thread_id: parsed.data.thread_id,
    }),
  });

  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "Server error" }, { status: res.status });
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
