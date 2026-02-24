import { getEntityById, updateEntity, getEntityItems } from "@edda/db";
import { NextResponse } from "next/server";
import { parseBody, notFound, badRequest, isUUID } from "../../_lib/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid entity ID");
  const entity = await getEntityById(id);
  if (!entity) return notFound("Entity");

  const url = new URL(request.url);
  const expand = url.searchParams.get("expand");
  if (expand?.includes("items")) {
    const items = await getEntityItems(id);
    return NextResponse.json({ ...entity, items });
  }

  return NextResponse.json(entity);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid entity ID");
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const entity = await updateEntity(id, body as { name?: string; description?: string });
  if (!entity) return notFound("Entity");
  return NextResponse.json(entity);
}
