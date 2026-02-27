import { getDashboard } from "@edda/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? undefined;
  const dashboard = await getDashboard(day);
  return NextResponse.json(dashboard);
}
