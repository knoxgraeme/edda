import { getItemById, updateItem, deleteItem } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, notFound, badRequest, isUUID } from "../../_lib/helpers";

const UpdateItemSchema = z
  .object({
    content: z.string().max(50000).optional(),
    summary: z.string().max(5000).nullable().optional(),
    status: z.enum(["active", "done", "archived", "snoozed"]).optional(),
    metadata: z.record(z.unknown()).optional(),
    day: z.string().max(10).optional(),
    completed_at: z.string().nullable().optional(),
    pending_action: z.string().max(200).nullable().optional(),
  })
  .strict(); // .strict() rejects unknown keys like embedding, confirmed, superseded_by

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

  let updates;
  try {
    updates = UpdateItemSchema.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid update fields" }, { status: 400 });
  }

  const item = await updateItem(id, updates);
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
