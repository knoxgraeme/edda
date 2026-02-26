import { NextResponse } from "next/server";
import { getSkills } from "@edda/db";

export async function GET() {
  const skills = await getSkills();
  return NextResponse.json(skills);
}
