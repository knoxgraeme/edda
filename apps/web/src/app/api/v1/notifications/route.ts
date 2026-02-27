import { NextRequest, NextResponse } from "next/server";
import { getInboxNotifications } from "@edda/db";
import { parseLimit } from "../_lib/helpers";

const VALID_STATUSES = new Set<"unread" | "read" | "dismissed">(["unread", "read", "dismissed"]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = parseLimit(req.url, 100, 50);
  const statusParam = url.searchParams.get("status");

  const status =
    statusParam && VALID_STATUSES.has(statusParam as "unread" | "read" | "dismissed")
      ? (statusParam as "unread" | "read" | "dismissed")
      : undefined;

  const rows = await getInboxNotifications({ status, limit });
  return NextResponse.json({ data: rows });
}
