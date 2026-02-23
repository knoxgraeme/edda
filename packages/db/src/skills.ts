/**
 * Skills — CRUD operations for the skills table.
 */

import { getPool } from "./connection.js";
import type { Skill, UpsertSkillInput } from "./types.js";

export async function upsertSkill(input: UpsertSkillInput): Promise<Skill> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO skills (name, description, content, is_system, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name) DO UPDATE SET
       description = EXCLUDED.description,
       content = EXCLUDED.content,
       version = CASE
         WHEN skills.content IS DISTINCT FROM EXCLUDED.content
         THEN skills.version + 1
         ELSE skills.version
       END,
       updated_at = now()
     RETURNING *`,
    [
      input.name,
      input.description,
      input.content,
      input.is_system ?? false,
      input.created_by ?? "seed",
    ],
  );
  return rows[0] as Skill;
}
