import { getSettings, updateSettings, getAgentByName } from "@edda/db";
import type { Settings } from "@edda/db";
import { NextResponse } from "next/server";
import { UpdateSettingsSchema } from "@/lib/settings-schema";
import { parseBody, badRequest } from "../_lib/helpers";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = UpdateSettingsSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  if (parsed.data.default_agent) {
    const agent = await getAgentByName(parsed.data.default_agent);
    if (!agent) return badRequest(`Agent "${parsed.data.default_agent}" does not exist`);
  }

  const settings = await updateSettings(parsed.data as Partial<Settings>);
  return NextResponse.json(settings);
}
