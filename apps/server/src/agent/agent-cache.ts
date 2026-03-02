/**
 * Shared agent cache — build, cache, and invalidate compiled agents.
 *
 * Extracted from server/index.ts so all entry points (web streaming,
 * channel adapters, cron, notify, run_agent) share the same cache.
 */

import type { Runnable } from "@langchain/core/runnables";
import type { Agent, RetrievalContext } from "@edda/db";
import { getAgentByName } from "@edda/db";
import { buildAgent } from "./build-agent.js";
import { resolveRetrievalContext } from "./tool-helpers.js";
import { getLogger } from "../logger.js";

export interface AgentState {
  agent: Runnable;
  agentName: string;
  agentRow: Agent;
  retrievalContext?: RetrievalContext;
}

interface CachedAgent {
  state: AgentState;
  cachedAt: number;
}

const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const agentCache = new Map<string, CachedAgent>();
const buildLocks = new Map<string, Promise<AgentState | null>>();

/**
 * Get a cached agent or build one from the DB.
 *
 * - TTL-based cache (5 minutes)
 * - Build coalescing: concurrent requests for the same agent share one build
 * - Returns null if agent not found or disabled
 */
export async function getOrBuildAgent(name: string): Promise<AgentState | null> {
  const cached = agentCache.get(name);
  if (cached && Date.now() - cached.cachedAt < AGENT_CACHE_TTL_MS) return cached.state;

  // Coalesce concurrent builds for the same agent
  const existing = buildLocks.get(name);
  if (existing) return existing;

  const buildPromise = (async (): Promise<AgentState | null> => {
    try {
      const agentRow = await getAgentByName(name);
      if (!agentRow || !agentRow.enabled) return null;

      const agent = await buildAgent(agentRow);
      const state: AgentState = {
        agent,
        agentName: agentRow.name,
        agentRow,
        retrievalContext: resolveRetrievalContext(agentRow.metadata, agentRow.name),
      };
      agentCache.set(name, { state, cachedAt: Date.now() });
      return state;
    } finally {
      buildLocks.delete(name);
    }
  })();

  buildLocks.set(name, buildPromise);
  return buildPromise;
}

/**
 * Pre-populate the cache with an already-built agent.
 * Used at startup to cache the default agent without a round-trip.
 */
export function setAgent(
  agent: Runnable,
  opts: { agentName: string; agentRow: Agent; retrievalContext?: RetrievalContext },
): void {
  const state: AgentState = { agent, ...opts };
  agentCache.set(opts.agentName, { state, cachedAt: Date.now() });
}

/**
 * Invalidate a cached agent so the next request triggers a fresh build.
 * Clears both the cache entry and any in-flight build lock to prevent
 * a stale build from re-populating the cache.
 */
export function invalidateAgent(name: string): void {
  agentCache.delete(name);
  buildLocks.delete(name);
  getLogger().debug({ agent: name }, "Agent cache invalidated");
}

/**
 * Invalidate ALL cached agents so every next request triggers a fresh build.
 * Call when a global change (e.g. MCP connection add/remove) affects the
 * tool pool shared by all agents.
 */
export function invalidateAllAgents(): void {
  const count = agentCache.size;
  agentCache.clear();
  buildLocks.clear();
  if (count > 0) {
    getLogger().debug({ count }, "All agent caches invalidated");
  }
}
