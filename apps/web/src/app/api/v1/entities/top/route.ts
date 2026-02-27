import { getTopEntities } from "@edda/db";
import { jsonList, parseLimit } from "../../_lib/helpers";

export async function GET(request: Request) {
  const limit = parseLimit(request.url, 50, 15);
  const entities = await getTopEntities(limit);
  return jsonList(entities);
}
