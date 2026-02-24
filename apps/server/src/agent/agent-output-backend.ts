/**
 * AgentOutputBackend — read-only backend mounted at /output/ on the orchestrator.
 *
 * Background agents write to Store via their /output/ StoreBackend mount,
 * which uses namespace [agentName, "filesystem", ...]. This backend reads from
 * those same namespaces, stitching all agent outputs into a unified /output/
 * directory tree.
 *
 * Orchestrator sees:                    Store namespace:
 * /output/                              (lists agents)
 * /output/daily_digest/                 [daily_digest, filesystem] -> search keys
 * /output/daily_digest/2026-02-23       [daily_digest, filesystem] -> get "2026-02-23"
 */

import type {
  BackendProtocol,
  EditResult,
  FileData,
  FileInfo,
  GrepMatch,
  WriteResult,
} from "deepagents";
import { getAgents } from "@edda/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoreRef = any;

/** Module-level cache shared across all AgentOutputBackend instances. */
let _agentCache: { names: string[]; ts: number } | null = null;

const STORE_SEARCH_LIMIT = 50;

export class AgentOutputBackend implements BackendProtocol {
  private store: StoreRef;

  constructor(rt: { state: unknown; store?: StoreRef }) {
    this.store = rt.store;
  }

  async lsInfo(path: string): Promise<FileInfo[]> {
    if (path === "/" || path === "") {
      const names = await this.getAgentNames();
      return names.map((n) => ({ path: `${n}/`, is_dir: true }));
    }

    const agentName = path.replace(/^\//, "").replace(/\/$/, "").split("/")[0];
    const items = await this.store.search([agentName, "filesystem"], { limit: STORE_SEARCH_LIMIT });
    return items.map((item: { key: string }) => ({
      path: `${agentName}/${item.key}`,
    }));
  }

  async read(path: string) {
    const parts = path.replace(/^\//, "").split("/");
    if (parts.length < 2) return "Use: read_file /output/<agent>/<key>";

    const [agentName, ...keyParts] = parts;
    const key = keyParts.join("/");
    const result = await this.store.get([agentName, "filesystem"], key);
    if (!result) return `No output found at /output/${agentName}/${key}`;
    return result.value?.content ?? JSON.stringify(result.value);
  }

  async readRaw(filePath: string): Promise<FileData> {
    const content = await this.read(filePath);
    const now = new Date().toISOString();
    return {
      content: typeof content === "string" ? content.split("\n") : [],
      created_at: now,
      modified_at: now,
    };
  }

  async write(): Promise<WriteResult> {
    return { error: "Agent outputs are read-only from the orchestrator." };
  }

  async edit(): Promise<EditResult> {
    return { error: "Agent outputs are read-only from the orchestrator." };
  }

  async grepRaw(query: string): Promise<GrepMatch[] | string> {
    const names = await this.getAgentNames();
    const results: GrepMatch[] = [];
    const allItems = await Promise.all(
      names.map(async (name) => ({
        name,
        items: await this.store.search([name, "filesystem"], { limit: STORE_SEARCH_LIMIT }),
      })),
    );
    for (const { name, items } of allItems) {
      for (const item of items) {
        const content: string = item.value?.content ?? "";
        if (content.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            path: `/output/${name}/${item.key}`,
            line: 1,
            text: content.slice(0, 200),
          });
        }
      }
    }
    return results;
  }

  async globInfo(pattern: string, _path?: string): Promise<FileInfo[]> {
    const names = await this.getAgentNames();
    const allItems = await Promise.all(
      names.map(async (name) => ({
        name,
        items: await this.store.search([name, "filesystem"], { limit: STORE_SEARCH_LIMIT }),
      })),
    );
    const results: FileInfo[] = [];
    for (const { name, items } of allItems) {
      for (const item of items) {
        const filePath = `/output/${name}/${item.key}`;
        if (matchGlob(pattern, filePath)) {
          results.push({ path: filePath });
        }
      }
    }
    return results;
  }

  private async getAgentNames(): Promise<string[]> {
    if (_agentCache && Date.now() - _agentCache.ts < 60_000) {
      return _agentCache.names;
    }
    const agents = await getAgents({ enabled: true });
    const names = agents.map((a) => a.name);
    _agentCache = { names, ts: Date.now() };
    return names;
  }
}

function matchGlob(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}
