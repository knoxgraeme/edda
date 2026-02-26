import { NextRequest, NextResponse } from "next/server";
import { getItemsByType } from "@edda/db";
import { parseLimit } from "../_lib/helpers";

export async function GET(req: NextRequest) {
  const limit = parseLimit(req.url, 100, 20);
  const rows = await getItemsByType("notification", "active", limit);
  return NextResponse.json(rows);
}
