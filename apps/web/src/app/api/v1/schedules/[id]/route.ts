import { NextRequest, NextResponse } from "next/server";
import { updateSchedule, deleteSchedule } from "@edda/db";
import { badRequest, isUUID, notFound } from "../../_lib/helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid id");

  const body = await req.json();
  try {
    const schedule = await updateSchedule(id, body);
    return NextResponse.json(schedule);
  } catch {
    return notFound("Schedule");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid id");

  try {
    await deleteSchedule(id);
    return NextResponse.json({ ok: true });
  } catch {
    return notFound("Schedule");
  }
}
