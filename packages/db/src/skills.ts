/**
 * Skills — CRUD operations for the skills table.
 */

import { getPool } from "./connection.js";
import type { Skill, UpsertSkillInput } from "./types.js";

export async function getSkills(): Promise<Skill[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM skills WHERE confirmed = true ORDER BY name`,
  );
  return rows as Skill[];
}

export async function getSkillByName(name: string): Promise<Skill | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM skills WHERE name = $1 AND confirmed = true`,
    [name],
  );
  return (rows[0] as Skill) ?? null;
}

export async function getSkillsByNames(names: string[]): Promise<Skill[]> {
  if (names.length === 0) return [];
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM skills WHERE name = ANY($1) AND confirmed = true`,
    [names],
  );
  return rows as Skill[];
}

export async function upsertSkill(input: UpsertSkillInput): Promise<Skill> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO skills (name, description, content, files, is_system, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (name) DO UPDATE SET
       description = EXCLUDED.description,
       content = EXCLUDED.content,
       files = EXCLUDED.files,
       version = CASE
         WHEN skills.content IS DISTINCT FROM EXCLUDED.content
           OR skills.files IS DISTINCT FROM EXCLUDED.files
         THEN skills.version + 1
         ELSE skills.version
       END,
       updated_at = now()
     RETURNING *`,
    [
      input.name,
      input.description,
      input.content,
      JSON.stringify(input.files ?? {}),
      input.is_system ?? false,
      input.created_by ?? "seed",
    ],
  );
  return rows[0] as Skill;
}
