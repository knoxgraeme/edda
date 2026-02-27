/**
 * Backend builders for the unified agent system.
 *
 * Every agent gets a CompositeBackend with:
 * - /skills/  → StoreBackend (scoped SKILL.md files for progressive disclosure)
 * - /store/   → StoreBackend readwrite (own namespace, always)
 * - /store/{name}/ → StoreBackend read|readwrite (cross-agent, from metadata.stores)
 *
 * The factory closes over the `store` instance so that deepagents' SkillsMiddleware
 * can access it during skill discovery (it only passes { state }, not { state, store }).
 */

import { StateBackend, StoreBackend, CompositeBackend } from "deepagents";
import type { BackendProtocol, WriteResult, EditResult } from "deepagents";
import type { BaseStore } from "@langchain/langgraph";
import { z } from "zod";
import type { Agent } from "@edda/db";
import { getAgents } from "@edda/db";

// ---------------------------------------------------------------------------
// Read-only wrappers
// ---------------------------------------------------------------------------

type StoreRt = { state: unknown; store?: BaseStore; assistantId?: string };

class ReadOnlyStoreBackend implements BackendProtocol {
  private inner: StoreBackend;

  constructor(rt: StoreRt) {
    this.inner = new StoreBackend(rt);
  }

  lsInfo(p: string) {
    return this.inner.lsInfo(p);
  }
  read(p: string, offset?: number, limit?: number) {
    return this.inner.read(p, offset, limit);
  }
  readRaw(p: string) {
    return this.inner.readRaw(p);
  }
  async write(): Promise<WriteResult> {
    return { error: "This store is mounted read-only." };
  }
  async edit(): Promise<EditResult> {
    return { error: "This store is mounted read-only." };
  }
  async uploadFiles(files: Array<[string, Uint8Array]>) {
    return files.map(([p]) => ({ path: p, error: "permission_denied" as const }));
  }
  grepRaw(query: string) {
    return this.inner.grepRaw(query);
  }
  globInfo(pattern: string, p?: string) {
    return this.inner.globInfo(pattern, p);
  }
}

// ---------------------------------------------------------------------------
// buildBackend — unified CompositeBackend factory
// ---------------------------------------------------------------------------

/**
 * Build a CompositeBackend factory for an agent.
 *
 * Async because cross-agent wildcard store access requires fetching the
 * agent list from the DB. The returned factory is synchronous (deepagents
 * requires BackendFactory to return BackendProtocol, not a Promise).
 *
 * Closes over `store` so StoreBackend always has access — even when
 * deepagents' SkillsMiddleware calls the factory with only { state }.
 */
// ---------------------------------------------------------------------------
// Metadata validation schemas
// ---------------------------------------------------------------------------

const SAFE_STORE_NAME = /^[a-z][a-z0-9_]*$/;

const StoreConfigSchema = z
  .record(z.string(), z.enum(["read", "readwrite"]))
  .optional();

// ---------------------------------------------------------------------------
// buildBackend
// ---------------------------------------------------------------------------

export async function buildBackend(
  agent: Agent,
  store: BaseStore,
): Promise<(rt: { state: unknown; store?: BaseStore }) => CompositeBackend> {
  // Pre-resolve cross-agent store names (needed for wildcard)
  const storeParseResult = StoreConfigSchema.safeParse(agent.metadata?.stores);
  if (!storeParseResult.success && agent.metadata?.stores !== undefined) {
    throw new Error(
      `Agent "${agent.name}" has invalid metadata.stores: ${storeParseResult.error.message}`,
    );
  }
  const storeConfig = storeParseResult.success ? storeParseResult.data : undefined;

  // Validate store name keys
  if (storeConfig) {
    for (const name of Object.keys(storeConfig)) {
      if (name !== "*" && !SAFE_STORE_NAME.test(name)) {
        throw new Error(
          `Agent "${agent.name}" has invalid store name "${name}". Names must match ${SAFE_STORE_NAME}.`,
        );
      }
    }
  }

  let wildcardAgentNames: string[] | null = null;
  if (storeConfig?.["*"]) {
    const allAgentRows = await getAgents({ enabled: true });
    wildcardAgentNames = allAgentRows
      .map((a) => a.name)
      .filter((n) => n !== agent.name);
  }

  // Return synchronous factory
  return (rt: { state: unknown; store?: BaseStore }) => {
    // Ensure store is always available (SkillsMiddleware passes { state } only)
    const storeRt = { ...rt, store: rt.store ?? store };

    const routes: Record<string, BackendProtocol> = {
      "/skills/": new StoreBackend(storeRt),
      "/store/": new StoreBackend({ ...storeRt, assistantId: agent.name }),
    };

    // Cross-agent store access
    if (storeConfig) {
      // Wildcard: mount pre-resolved agent stores
      if (wildcardAgentNames) {
        const wildcardMode = storeConfig["*"];
        for (const name of wildcardAgentNames) {
          if (wildcardMode === "read") {
            routes[`/store/${name}/`] = new ReadOnlyStoreBackend({
              ...storeRt,
              assistantId: name,
            });
          } else {
            routes[`/store/${name}/`] = new StoreBackend({
              ...storeRt,
              assistantId: name,
            });
          }
        }
      }

      // Named entries (override wildcard for specific agents)
      for (const [name, mode] of Object.entries(storeConfig)) {
        if (name === "*") continue;
        if (mode === "read") {
          routes[`/store/${name}/`] = new ReadOnlyStoreBackend({
            ...storeRt,
            assistantId: name,
          });
        } else {
          routes[`/store/${name}/`] = new StoreBackend({
            ...storeRt,
            assistantId: name,
          });
        }
      }
    }

    return new CompositeBackend(new StateBackend(rt), routes);
  };
}
