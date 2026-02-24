import { getEntityConnections } from "@edda/db";
import { jsonList, parseLimit, badRequest, isUUID } from "../../../_lib/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid entity ID");
  const limit = parseLimit(request.url, 50, 10);
  const connections = await getEntityConnections(id, limit);
  return jsonList(connections);
}
