import { confirmPending, rejectPending } from "@edda/db";
import { NextResponse } from "next/server";
import { badRequest } from "../../../_lib/helpers";

const VALID_TABLES = new Set(["items", "entities", "item_types", "telegram_paired_users"]);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const { table, id } = await params;
  if (!VALID_TABLES.has(table)) return badRequest("Invalid table");

  await confirmPending(table as "items" | "entities" | "item_types" | "telegram_paired_users", id);
  return NextResponse.json({ confirmed: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const { table, id } = await params;
  if (!VALID_TABLES.has(table)) return badRequest("Invalid table");

  await rejectPending(table as "items" | "entities" | "item_types" | "telegram_paired_users", id);
  return NextResponse.json({ rejected: true });
}
