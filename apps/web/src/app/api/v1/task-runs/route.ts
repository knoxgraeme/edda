import { getRecentTaskRuns } from "@edda/db";
import type { TaskRunStatus } from "@edda/db";
import { jsonList, parseLimit } from "../_lib/helpers";

const VALID_STATUSES = new Set<string>(["pending", "running", "completed", "failed", "cancelled"]);

export async function GET(request: Request) {
  const limit = parseLimit(request.url);
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const status =
    rawStatus && VALID_STATUSES.has(rawStatus) ? (rawStatus as TaskRunStatus) : undefined;

  const runs = await getRecentTaskRuns({ status, limit });
  return jsonList(runs);
}
