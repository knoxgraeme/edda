/**
 * Type reference generator — writes capture/references/types.md
 *
 * Queries all confirmed, non-agent-internal item types and generates
 * a markdown reference file used by the capture skill.
 * Called on startup and after type_evolution creates/modifies types.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getItemTypes } from "@edda/db";

const AGENT_INTERNAL_TYPES = new Set(["preference", "learned_fact", "pattern"]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, "../..");
const OUTPUT_PATH = join(SERVER_ROOT, "skills/capture/references/types.md");
const OUTPUT_TMP = OUTPUT_PATH + ".tmp";

export async function generateTypeReference(): Promise<void> {
  const allTypes = await getItemTypes();
  const types = allTypes.filter((t) => !AGENT_INTERNAL_TYPES.has(t.name));

  const lines: string[] = [
    "# Item Type Reference",
    "",
    "> Auto-generated from the item_types table. Do not edit manually.",
    "",
  ];

  for (const t of types) {
    lines.push(`## ${t.name}`);
    lines.push(`- **Icon:** ${t.icon}`);
    lines.push(`- **Description:** ${t.description}`);
    lines.push(`- **Classification Hint:** ${t.classification_hint}`);

    const schemaKeys = Object.keys(t.metadata_schema);
    if (schemaKeys.length > 0) {
      lines.push("- **Metadata Schema:**");
      lines.push("```json");
      lines.push(JSON.stringify(t.metadata_schema, null, 2));
      lines.push("```");
    }

    if (t.is_user_created) {
      lines.push("- *User-created type*");
    }

    lines.push("");
  }

  const content = lines.join("\n");

  // Ensure directory exists
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });

  // Atomic write
  await writeFile(OUTPUT_TMP, content, "utf-8");
  await rename(OUTPUT_TMP, OUTPUT_PATH);
}
