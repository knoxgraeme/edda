import { getGraphData } from "@edda/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entityLimit = Math.min(
    Math.max(parseInt(url.searchParams.get("entities") ?? "60", 10) || 60, 5),
    300,
  );
  const itemsPerEntity = Math.min(
    Math.max(parseInt(url.searchParams.get("items") ?? "8", 10) || 8, 0),
    50,
  );

  try {
    const data = await getGraphData({ entityLimit, itemsPerEntity });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load graph data";
    console.error("[api/v1/graph] getGraphData failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
