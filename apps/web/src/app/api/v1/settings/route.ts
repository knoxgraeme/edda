import { getSettings, updateSettings } from "@edda/db";
import type { LlmProvider, EmbeddingProvider, Settings } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, badRequest } from "../_lib/helpers";

const LLM_PROVIDERS: LlmProvider[] = [
  "anthropic", "openai", "google", "groq", "ollama", "mistral", "bedrock",
];
const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ["voyage", "openai", "google"];

const UpdateSettingsSchema = z
  .object({
    user_display_name: z.string().max(200).optional(),
    user_timezone: z.string().max(100).optional(),
    llm_provider: z.enum(LLM_PROVIDERS as [string, ...string[]]).optional(),
    llm_model: z.string().max(100).optional(),
    embedding_provider: z.enum(EMBEDDING_PROVIDERS as [string, ...string[]]).optional(),
    embedding_model: z.string().max(100).optional(),
    notification_targets: z.array(z.string()).optional(),
    context_refresh_cron: z.string().max(50).optional(),
  })
  .strict();

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = UpdateSettingsSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const settings = await updateSettings(parsed.data as Partial<Settings>);
  return NextResponse.json(settings);
}
