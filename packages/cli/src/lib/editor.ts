/**
 * `$EDITOR` pop-out helper.
 *
 * Writes `initialContent` to a temp file, opens it in the user's
 * editor, and returns the saved content. Falls back to `vi` when
 * `EDITOR`/`VISUAL` are unset.
 *
 * Used by commands that let the user author longer-form text
 * (system prompts, AGENTS.md) where a `@clack/prompts` input would
 * be miserable.
 */

import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface EditorOptions {
  /** Suffix to use for the temp file (determines editor syntax highlighting). */
  suffix?: string;
  /** Prefix for the temp file name (defaults to `edda-edit`). */
  prefix?: string;
}

/**
 * Open `initialContent` in `$EDITOR` and return the saved text.
 * Throws if the editor exits with a non-zero code.
 */
export async function openInEditor(
  initialContent: string,
  options: EditorOptions = {},
): Promise<string> {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const suffix = options.suffix ?? ".md";
  const prefix = options.prefix ?? "edda-edit";
  const tmpFile = join(tmpdir(), `${prefix}-${randomBytes(8).toString("hex")}${suffix}`);

  await writeFile(tmpFile, initialContent, "utf8");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [tmpFile], { stdio: "inherit" });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Editor (${editor}) exited with code ${code}`));
      });
      child.on("error", (err) => reject(err));
    });
    return await readFile(tmpFile, "utf8");
  } finally {
    await unlink(tmpFile).catch(() => {
      // best-effort cleanup
    });
  }
}
