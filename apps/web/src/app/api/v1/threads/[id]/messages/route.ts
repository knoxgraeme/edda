import { NextResponse } from "next/server";
import { badRequest } from "../../../_lib/helpers";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8000";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

/** Thread IDs are alphanumeric strings with hyphens, underscores, colons */
const THREAD_ID_RE = /^[a-zA-Z0-9_:-]+$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!THREAD_ID_RE.test(id)) return badRequest("Invalid thread ID");

  const res = await fetch(`${SERVER_URL}/api/threads/${encodeURIComponent(id)}`, {
    headers: {
      ...(INTERNAL_API_SECRET ? { Authorization: `Bearer ${INTERNAL_API_SECRET}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: res.status });
  }
  return NextResponse.json(await res.json());
}
