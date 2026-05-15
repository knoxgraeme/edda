import { getEntityById, updateEntity, getEntityItems } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, notFound, badRequest, isUUID } from "../../_lib/helpers";

const UpdateEntitySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
  })
  .strict();

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
    const rawLimit = parseInt(url.searchParams.get("items_limit") ?? "20", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 20 : rawLimit, 1), 500);
    const items = await getEntityItems(id, { limit });
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

  const parsed = UpdateEntitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update fields" }, { status: 400 });
  }

  const entity = await updateEntity(id, parsed.data);
  if (!entity) return notFound("Entity");
  return NextResponse.json(entity);
}
