import { updateMcpConnection, deleteMcpConnection } from "@edda/db";
import { NextResponse } from "next/server";
import { parseBody, notFound, badRequest, isUUID } from "../../_lib/helpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid connection ID");
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const connection = await updateMcpConnection(id, body as Record<string, unknown>);
  if (!connection) return notFound("MCP connection");
  return NextResponse.json(connection);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid connection ID");
  await deleteMcpConnection(id);
  return NextResponse.json({ deleted: true });
}
