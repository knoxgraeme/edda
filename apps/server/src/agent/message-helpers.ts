/**
 * Shared message utilities — used by post-process middleware and memory extraction cron.
 */

export interface MessageLike {
  type?: string;
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
  name?: string;
  additional_kwargs?: Record<string, unknown>;
}

export function getMessageText(msg: MessageLike): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

export function getMessageRole(msg: MessageLike): string {
  return msg.role ?? msg.type ?? "unknown";
}

export function buildTranscript(messages: MessageLike[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = getMessageRole(msg);
    const text = getMessageText(msg);
    if (text.trim()) {
      lines.push(`[${role}]: ${text}`);
    }
  }
  return lines.join("\n\n");
}
