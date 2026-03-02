import { getAgentMetrics, getSystemMetrics } from "@edda/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawDays = parseInt(url.searchParams.get("days") ?? "7", 10);
    const days = Math.max(1, Math.min(isNaN(rawDays) ? 7 : rawDays, 90));

    const [agents, system] = await Promise.all([
      getAgentMetrics(days),
      getSystemMetrics(),
    ]);

    return NextResponse.json({ agents, system });
  } catch {
    return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
}
