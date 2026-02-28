/**
 * Checkpointer factory — returns a BaseCheckpointSaver based on DB settings.
 *
 * Source of truth: settings.checkpointer_backend
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { getSettingsSync } from "@edda/db";

let _checkpointer: BaseCheckpointSaver | null = null;

/** Returns the cached checkpointer instance (available after agent init). */
export function getSharedCheckpointer(): BaseCheckpointSaver | null {
  return _checkpointer;
}

export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (_checkpointer) return _checkpointer;

  const settings = getSettingsSync();
  const backend = settings.checkpointer_backend || "postgres";

  let saver: BaseCheckpointSaver;

  switch (backend) {
    case "postgres": {
      const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres");
      const pgSaver = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
      await pgSaver.setup();
      saver = pgSaver;
      break;
    }
    case "sqlite": {
      // @ts-expect-error — optional dependency, only needed when checkpointer_backend=sqlite
      const { SqliteSaver } = await import("@langchain/langgraph-checkpoint-sqlite");
      const path = process.env.SQLITE_PATH || "./edda-checkpoints.db";
      saver = SqliteSaver.fromConnString(path);
      break;
    }
    case "memory": {
      const { MemorySaver } = await import("@langchain/langgraph");
      saver = new MemorySaver();
      break;
    }
    default:
      throw new Error(`Unknown checkpointer backend: ${backend}`);
  }

  _checkpointer = saver;
  return saver;
}
