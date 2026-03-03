import { NextRequest, NextResponse } from "next/server";
import { listPendingActions } from "@edda/db";
import type { PendingActionStatus } from "@edda/db";
import { parseLimit } from "../_lib/helpers";

const VALID_STATUSES = new Set<PendingActionStatus>(["pending", "approved", "rejected", "expired"]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = parseLimit(req.url, 100, 50);
  const statusParam = url.searchParams.get("status");
  const agentName = url.searchParams.get("agent_name") ?? undefined;

  const status =
    statusParam && VALID_STATUSES.has(statusParam as PendingActionStatus)
      ? (statusParam as PendingActionStatus)
      : undefined;

  const rows = await listPendingActions({ status, agent_name: agentName, limit });
  return NextResponse.json({ data: rows });
}
