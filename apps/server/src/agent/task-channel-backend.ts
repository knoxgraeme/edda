/**
 * TaskChannelBackend — read-only backend mounted at /channels/ on the orchestrator.
 *
 * Channel agents write to Store via their /output/ StoreBackend mount (Phase 2b),
 * which uses namespace [agentName, "filesystem", ...]. This backend reads from
 * those same namespaces, stitching all agent outputs into a unified /channels/
 * directory tree.
 *
 * Orchestrator sees:                    Store namespace:
 * /channels/                            (lists agent_definitions)
 * /channels/daily_digest/               [daily_digest, filesystem] -> search keys
 * /channels/daily_digest/2026-02-23     [daily_digest, filesystem] -> get "2026-02-23"
 */

import type { BackendProtocol, EditResult, FileData, FileInfo, WriteResult } from "deepagents";
import { getAgentDefinitions } from "@edda/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoreRef = any;

export class TaskChannelBackend implements BackendProtocol {
  private store: StoreRef;
  private _agentCache: { names: string[]; ts: number } | null = null;

  constructor(rt: { state: unknown; store?: StoreRef }) {
    this.store = rt.store;
  }

  async lsInfo(path: string) {
    if (path === "/" || path === "") {
      const names = await this.getAgentNames();
      return names.map((n) => ({ name: n, type: "directory" as const }));
    }

    const agentName = path.replace(/^\//, "").replace(/\/$/, "").split("/")[0];
    const items = await this.store.search([agentName, "filesystem"]);
    return items.map((item: { key: string }) => ({
      name: item.key,
      type: "file" as const,
    }));
  }

  async read(path: string) {
    const parts = path.replace(/^\//, "").split("/");
    if (parts.length < 2) return "Use: read_file /channels/<agent>/<key>";

    const [agentName, ...keyParts] = parts;
    const key = keyParts.join("/");
    const result = await this.store.get([agentName, "filesystem"], key);
    if (!result) return `No output found at /channels/${agentName}/${key}`;
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
    return { error: "Channels are read-only from the orchestrator." };
  }

  async edit(): Promise<EditResult> {
    return { error: "Channels are read-only from the orchestrator." };
  }

  async grepRaw(query: string) {
    const names = await this.getAgentNames();
    const results: string[] = [];
    for (const name of names) {
      const items = await this.store.search([name, "filesystem"], { limit: 5 });
      for (const item of items) {
        const content = item.value?.content ?? "";
        if (content.toLowerCase().includes(query.toLowerCase())) {
          results.push(`/channels/${name}/${item.key}: ${content.slice(0, 200)}`);
        }
      }
    }
    return results.join("\n");
  }

  async globInfo(pattern: string, _path?: string): Promise<FileInfo[]> {
    const names = await this.getAgentNames();
    const results: FileInfo[] = [];
    for (const name of names) {
      const items = await this.store.search([name, "filesystem"]);
      for (const item of items) {
        const filePath = `/channels/${name}/${item.key}`;
        // Simple glob matching: support * wildcard
        if (matchGlob(pattern, filePath)) {
          results.push({ path: filePath });
        }
      }
    }
    return results;
  }

  private async getAgentNames(): Promise<string[]> {
    if (this._agentCache && Date.now() - this._agentCache.ts < 60_000) {
      return this._agentCache.names;
    }
    const agents = await getAgentDefinitions({ enabled: true });
    const names = agents.map((a) => a.name);
    this._agentCache = { names, ts: Date.now() };
    return names;
  }
}

function matchGlob(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}
