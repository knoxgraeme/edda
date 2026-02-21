/**
 * types.md generator — writes item type reference for the capture skill
 *
 * Queries item_types from Postgres, formats into markdown,
 * writes to ./skills/capture/references/types.md.
 * Called on server startup alongside generateAgentsMd.
 */

import { writeFile } from "fs/promises";
import { getItemTypes } from "@edda/db";

export async function generateTypesMd(): Promise<void> {
  const types = await getItemTypes();

  const sections = types.map((t) => {
    const flags = [
      t.completable && "completable",
      t.has_due_date && "has_due_date",
      t.is_list && "is_list",
      t.private && "private",
      t.agent_internal && "agent_internal",
    ]
      .filter(Boolean)
      .join(", ");

    return [
      `### ${t.icon} ${t.name}`,
      t.description,
      `- **Classification:** ${t.classification_hint}`,
      `- **Extraction hint:** ${t.extraction_hint || "(none)"}`,
      `- **Metadata schema:** \`${JSON.stringify(t.metadata_schema)}\``,
      `- **Flags:** ${flags || "none"}`,
    ].join("\n");
  });

  const content = `# Edda Item Types\n\nAuto-generated reference for the capture skill.\n\n${sections.join("\n\n")}\n`;
  await writeFile("./skills/capture/references/types.md", content, "utf-8");
}
