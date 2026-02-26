import { NextRequest, NextResponse } from "next/server";
import { dismissNotification, markNotificationsRead } from "@edda/db";
import { isUUID, notFound, badRequest, parseBody } from "../../_lib/helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid notification ID");

  const body = await parseBody(req);
  if (body instanceof NextResponse) return body;

  const { status } = body as { status?: string };
  if (!status || !["read", "dismissed"].includes(status)) {
    return badRequest("status must be 'read' or 'dismissed'");
  }

  if (status === "dismissed") {
    const result = await dismissNotification(id);
    if (!result) return notFound("Notification");
    return NextResponse.json(result);
  }

  // status === "read"
  await markNotificationsRead([id]);
  return NextResponse.json({ id, status: "read" });
}
