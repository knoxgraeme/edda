import { NextResponse } from "next/server";
import { badRequest, isUUID } from "../../../_lib/helpers";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid thread ID");

  const res = await fetch(`${SERVER_URL}/api/threads/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: res.status });
  }
  return NextResponse.json(await res.json());
}
