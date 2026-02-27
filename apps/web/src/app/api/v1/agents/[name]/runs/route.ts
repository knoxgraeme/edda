import { getRecentTaskRuns } from "@edda/db";
import { jsonList, parseLimit } from "../../../_lib/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const limit = parseLimit(request.url);
  const runs = await getRecentTaskRuns({ agent_name: name, limit });
  return jsonList(runs);
}
