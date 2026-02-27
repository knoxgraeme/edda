import { NextRequest, NextResponse } from "next/server";
import { getScheduledReminders } from "@edda/db";
import { parseLimit } from "../_lib/helpers";

export async function GET(req: NextRequest) {
  try {
    const limit = parseLimit(req.url, 100, 50);
    const rows = await getScheduledReminders({ limit });
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error("GET /api/v1/reminders failed:", err);
    return NextResponse.json({ error: "Failed to fetch reminders" }, { status: 500 });
  }
}
