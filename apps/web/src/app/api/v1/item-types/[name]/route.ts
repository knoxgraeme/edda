import { deleteItemType } from "@edda/db";
import { NextResponse } from "next/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  await deleteItemType(name);
  return NextResponse.json({ deleted: true });
}
