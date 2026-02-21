/**
 * Checkpointer factory — returns a BaseCheckpointSaver based on settings + env override
 *
 * Precedence: env CHECKPOINTER → settings.checkpointer_backend → "postgres"
 */

import { getSettingsSync } from "@edda/db";

export async function getCheckpointer(): Promise<unknown> {
  const settings = getSettingsSync();
  const backend = process.env.CHECKPOINTER || settings.checkpointer_backend || "postgres";

  switch (backend) {
    case "postgres": {
      const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
      const saver = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
      await saver.setup();
      return saver;
    }
    case "sqlite": {
      const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
      const path = process.env.SQLITE_PATH || "./edda-checkpoints.db";
      return SqliteSaver.fromConnString(path);
    }
    case "memory": {
      const { MemorySaver } = require("@langchain/langgraph");
      return new MemorySaver();
    }
    default:
      throw new Error(`Unknown checkpointer backend: ${backend}`);
  }
}
