import { listThreads } from "@edda/db";
import { jsonList, parseLimit } from "../_lib/helpers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = parseLimit(request.url);
  const agentName = url.searchParams.get("agent_name") ?? undefined;
  const threads = await listThreads(limit, agentName);
  return jsonList(threads);
}
