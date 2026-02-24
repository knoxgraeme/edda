import { getTimeline } from "@edda/db";
import { jsonList, parseLimit, badRequest } from "../_lib/helpers";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!start || !end) return badRequest("start and end are required");
  if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end))
    return badRequest("start and end must be ISO dates (YYYY-MM-DD)");

  const types = url.searchParams.get("type")?.split(",") ?? undefined;
  const limit = parseLimit(request.url, 500, 100);

  const items = await getTimeline(start, end, types, limit);
  return jsonList(items);
}
