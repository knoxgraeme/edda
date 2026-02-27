import { getRunningTaskCount } from "@edda/db";
import { NextResponse } from "next/server";

export async function GET() {
  const count = await getRunningTaskCount();
  return NextResponse.json({ count });
}
