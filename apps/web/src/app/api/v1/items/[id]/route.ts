import { getItemById, updateItem, deleteItem } from "@edda/db";
import { NextResponse } from "next/server";
import { parseBody, notFound, badRequest, isUUID } from "../../_lib/helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid item ID");
  const item = await getItemById(id);
  if (!item) return notFound("Item");
  return NextResponse.json(item);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid item ID");
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const item = await updateItem(id, body as Record<string, unknown>);
  if (!item) return notFound("Item");
  return NextResponse.json(item);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid item ID");
  const deleted = await deleteItem(id);
  if (!deleted) return notFound("Item");
  return NextResponse.json({ deleted: true });
}
