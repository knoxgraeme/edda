import { getListItems } from "@edda/db";
import { jsonList, parseLimit } from "../../../_lib/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const limit = parseLimit(request.url, 500, 200);
  const items = await getListItems(name, limit);
  return jsonList(items);
}
