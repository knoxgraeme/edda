import { NextResponse } from "next/server";
import { notFound, getServerUrl } from "../../../_lib/helpers";

const SERVER_URL = getServerUrl();
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  const res = await fetch(
    `${SERVER_URL}/api/agents/${encodeURIComponent(name)}/thread`,
    {
      headers: {
        ...(INTERNAL_API_SECRET ? { Authorization: `Bearer ${INTERNAL_API_SECRET}` } : {}),
      },
    },
  );

  if (res.status === 404) return notFound("Agent");

  if (!res.ok) {
    return NextResponse.json({ error: "Server error" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
