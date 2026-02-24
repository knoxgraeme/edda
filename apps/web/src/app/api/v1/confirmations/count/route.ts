import { getPendingConfirmationsCount } from "@edda/db";
import { NextResponse } from "next/server";

export async function GET() {
  const count = await getPendingConfirmationsCount();
  return NextResponse.json({ count });
}
