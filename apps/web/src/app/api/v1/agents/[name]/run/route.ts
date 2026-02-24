import { getAgentByName } from "@edda/db";
import { NextResponse } from "next/server";
import { notFound } from "../../../_lib/helpers";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8000";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const definition = await getAgentByName(name);
  if (!definition) return notFound("Agent");

  const res = await fetch(`${SERVER_URL}/api/agents/${encodeURIComponent(name)}/run`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Server error" }, { status: res.status });
  }
  return NextResponse.json(await res.json(), { status: 202 });
}
