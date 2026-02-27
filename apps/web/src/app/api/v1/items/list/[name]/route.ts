import { getListByName, getListItems } from "@edda/db";
import { jsonList, parseLimit } from "../../../_lib/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (name.length > 200) {
    return Response.json({ error: "List name too long (max 200 chars)" }, { status: 400 });
  }
  const list = await getListByName(name);
  if (!list) return jsonList([]);
  const limit = parseLimit(request.url, 500, 200);
  const items = await getListItems(list.id, limit);
  return jsonList(items);
}
