import { redirect } from "next/navigation";
import { getSettings } from "@edda/db";

export default async function ChatPage() {
  const settings = await getSettings();
  redirect(`/agents/${encodeURIComponent(settings.default_agent)}`);
}
