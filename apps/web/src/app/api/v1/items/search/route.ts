import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, badRequest } from "../../_lib/helpers";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8000";

const SearchSchema = z.object({
  query: z.string().min(1).max(1000),
  type: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = SearchSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const res = await fetch(`${SERVER_URL}/api/search/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Search failed" }, { status: res.status });
  }
  return NextResponse.json(await res.json());
}
