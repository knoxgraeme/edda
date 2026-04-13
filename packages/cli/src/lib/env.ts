/**
 * .env file parser + section-aware serializer.
 *
 * Used by `edda init` to merge wizard answers into an existing .env file
 * without clobbering unknown keys (e.g. MCP_AUTH_*, LANGSMITH_*, user-added vars).
 *
 * This intentionally does NOT preserve comments or blank lines from the original
 * file — it re-renders with a consistent section layout defined by the caller.
 */

export interface EnvSection {
  title: string;
  keys: string[];
}

/** Parse a .env file into a key → value Map, dropping comments and blank lines. */
export function parseEnvFile(content: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    const value = unquote(line.slice(eq + 1));
    env.set(key, value);
  }
  return env;
}

/**
 * Serialize an env map into a .env file string.
 *
 * Keys listed in `sections` are emitted in order, grouped under section headers.
 * Any keys present in `env` but not referenced in `sections` are preserved
 * under a trailing "Other (preserved)" section.
 */
export function serializeEnvFile(
  env: Map<string, string>,
  sections: EnvSection[],
  header?: string,
): string {
  const lines: string[] = [];
  if (header) {
    for (const line of header.split("\n")) lines.push(line);
    lines.push("");
  }

  const seen = new Set<string>();

  for (const section of sections) {
    const sectionLines: string[] = [];
    for (const key of section.keys) {
      if (seen.has(key)) continue;
      if (!env.has(key)) continue;
      sectionLines.push(`${key}=${quote(env.get(key) ?? "")}`);
      seen.add(key);
    }
    if (sectionLines.length > 0) {
      lines.push(sectionHeader(section.title));
      lines.push(...sectionLines);
      lines.push("");
    }
  }

  const leftover = [...env.keys()].filter((k) => !seen.has(k));
  if (leftover.length > 0) {
    lines.push(sectionHeader("Other (preserved)"));
    for (const key of leftover) {
      lines.push(`${key}=${quote(env.get(key) ?? "")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function sectionHeader(title: string): string {
  const filler = Math.max(1, 60 - title.length);
  return `# ─── ${title} ${"─".repeat(filler)}`;
}

function quote(value: string): string {
  if (value === "") return '""';
  if (/[\s#"'$\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  return v;
}
