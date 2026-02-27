import { getSettings, updateSettings, getAgentByName } from "@edda/db";
import type { LlmProvider, EmbeddingProvider, SandboxProvider, Settings } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, badRequest } from "../_lib/helpers";

const LLM_PROVIDERS: LlmProvider[] = [
  "anthropic", "openai", "google", "groq", "ollama", "mistral", "bedrock",
];
const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ["voyage", "openai", "google"];
const SANDBOX_PROVIDERS: SandboxProvider[] = ["none", "node-vfs"];

const UpdateSettingsSchema = z
  .object({
    user_display_name: z.string().max(200).optional(),
    user_timezone: z.string().max(100).optional(),
    llm_provider: z.enum(LLM_PROVIDERS as [string, ...string[]]).optional(),
    default_model: z.string().max(100).optional(),
    embedding_provider: z.enum(EMBEDDING_PROVIDERS as [string, ...string[]]).optional(),
    embedding_model: z.string().max(100).optional(),
    default_agent: z.string().min(1).max(200).optional(),
    sandbox_provider: z.enum(SANDBOX_PROVIDERS as [string, ...string[]]).optional(),
  })
  .strip();

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
