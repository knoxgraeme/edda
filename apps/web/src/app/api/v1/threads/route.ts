import { listThreads } from "@edda/db";
import { jsonList, parseLimit } from "../_lib/helpers";

export async function GET(request: Request) {
  const limit = parseLimit(request.url);
  const threads = await listThreads(limit);
  return jsonList(threads);
}
