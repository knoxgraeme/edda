import { NextResponse } from "next/server";
import { getServerUrl } from "../../../_lib/helpers";

const SERVER_URL = getServerUrl();
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const res = await fetch(`${SERVER_URL}/api/agents/${encodeURIComponent(name)}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(INTERNAL_API_SECRET ? { Authorization: `Bearer ${INTERNAL_API_SECRET}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Server error" }, { status: res.status });
  }
  return NextResponse.json(await res.json(), { status: 202 });
}
