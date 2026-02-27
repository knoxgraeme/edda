import { NextResponse } from "next/server";
import { notFound } from "../../../_lib/helpers";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  const res = await fetch(
    `${SERVER_URL}/api/agents/${encodeURIComponent(name)}/thread`,
  );

  if (res.status === 404) return notFound("Agent");

  if (!res.ok) {
    return NextResponse.json({ error: "Server error" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
