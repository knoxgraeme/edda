"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { Network, RefreshCw, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// react-force-graph-2d's generics get erased by next/dynamic, so we cast to a
// permissive component type. The accessor callbacks are typed via GraphNode below.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as ComponentType<Record<string, unknown>>;

interface GraphNode {
  id: string;
  label: string;
  kind: "entity" | "item";
  group: string;
  weight: number;
  description?: string | null;
  aliases?: string[];
  content?: string | null;
  created_at?: string | null;
  last_seen_at?: string | null;
  last_reinforced_at?: string | null;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relationship?: string;
}

function linkEndId(end: string | GraphNode): string {
  return typeof end === "string" ? end : end.id;
}

// Shape of GET /api/v1/entities/[id]?expand=items (Entity + items[])
interface EntityDetail {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  description: string | null;
  mention_count: number;
  last_seen_at: string;
  confirmed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  items?: ItemDetail[];
}

// Shape of GET /api/v1/items/[id] — full Item row
interface ItemDetail {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  status: string;
  source: string;
  day: string;
  confirmed: boolean;
  completed_at: string | null;
  last_reinforced_at: string | null;
  created_at: string;
  updated_at: string;
}

type NodeDetail =
  | { kind: "entity"; data: EntityDetail }
  | { kind: "item"; data: ItemDetail };

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const ENTITY_COLORS: Record<string, string> = {
  person: "#f59e0b",
  project: "#3b82f6",
  company: "#8b5cf6",
  topic: "#10b981",
  place: "#ef4444",
  tool: "#06b6d4",
  concept: "#ec4899",
};

const ITEM_FALLBACK = "#94a3b8";

function colorFor(node: GraphNode): string {
  if (node.kind === "entity") return ENTITY_COLORS[node.group] ?? "#a78bfa";
  // Stable hash → hue for item types
  let hash = 0;
  for (let i = 0; i < node.group.length; i++) hash = (hash * 31 + node.group.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 65%)`;
}

export function GraphClient() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityLimit, setEntityLimit] = useState(60);
  const [itemsPerEntity, setItemsPerEntity] = useState(8);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailCacheRef = useRef<Map<string, NodeDetail>>(new Map());
  const [showControls, setShowControls] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<unknown>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/graph?entities=${entityLimit}&items=${itemsPerEntity}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GraphData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [entityLimit, itemsPerEntity]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetch full details whenever the user selects a node
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const cacheKey = `${selected.kind}:${selected.id}`;
    const cached = detailCacheRef.current.get(cacheKey);
    if (cached) {
      setDetail(cached);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    const url =
      selected.kind === "entity"
        ? `/api/v1/entities/${selected.id}?expand=items&items_limit=500`
        : `/api/v1/items/${selected.id}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const next: NodeDetail =
          selected.kind === "entity"
            ? { kind: "entity", data: data as EntityDetail }
            : { kind: "item", data: data as ItemDetail };
        detailCacheRef.current.set(cacheKey, next);
        setDetail(next);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const groups = useMemo(() => {
    if (!data) return { entities: [], items: [] };
    const eSet = new Set<string>();
    const iSet = new Set<string>();
    for (const n of data.nodes) {
      if (n.kind === "entity") eSet.add(n.group);
      else iSet.add(n.group);
    }
    return {
      entities: Array.from(eSet).sort(),
      items: Array.from(iSet).sort(),
    };
  }, [data]);

  const nodeCounts = useMemo(() => {
    if (!data) return { entities: 0, items: 0, links: 0 };
    let e = 0;
    let i = 0;
    for (const n of data.nodes) {
      if (n.kind === "entity") e++;
      else i++;
    }
    return { entities: e, items: i, links: data.links.length };
  }, [data]);

  // Adjacency: node id -> set of connected neighbor ids and the link relationships
  const adjacency = useMemo(() => {
    const neighbors = new Map<string, Map<string, string | undefined>>();
    if (!data) return neighbors;
    for (const n of data.nodes) neighbors.set(n.id, new Map());
    for (const l of data.links) {
      const s = linkEndId(l.source);
      const t = linkEndId(l.target);
      neighbors.get(s)?.set(t, l.relationship);
      neighbors.get(t)?.set(s, l.relationship);
    }
    return neighbors;
  }, [data]);

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    if (!data) return map;
    for (const n of data.nodes) map.set(n.id, n);
    return map;
  }, [data]);

  const selectedNeighbors = useMemo(() => {
    if (!selected) return null;
    const raw = adjacency.get(selected.id);
    if (!raw) return [] as Array<{ node: GraphNode; relationship?: string }>;
    const list: Array<{ node: GraphNode; relationship?: string }> = [];
    for (const [id, rel] of raw.entries()) {
      const n = nodesById.get(id);
      if (n) list.push({ node: n, relationship: rel });
    }
    // Entities first, then by weight desc
    list.sort((a, b) => {
      if (a.node.kind !== b.node.kind) return a.node.kind === "entity" ? -1 : 1;
      return b.node.weight - a.node.weight;
    });
    return list;
  }, [selected, adjacency, nodesById]);

  const isHighlighted = useCallback(
    (nodeId: string) => {
      if (!selected) return true;
      if (nodeId === selected.id) return true;
      return adjacency.get(selected.id)?.has(nodeId) ?? false;
    },
    [selected, adjacency],
  );

  const isLinkHighlighted = useCallback(
    (link: GraphLink) => {
      if (!selected) return true;
      const s = linkEndId(link.source);
      const t = linkEndId(link.target);
      return s === selected.id || t === selected.id;
    },
    [selected],
  );

  return (
    <main className="relative h-screen w-full overflow-hidden bg-background">
      <div ref={containerRef} className="absolute inset-0">
        {data && data.nodes.length > 0 && (
          <ForceGraph2D
            ref={graphRef as never}
            graphData={data as never}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor="transparent"
            nodeRelSize={4}
            nodeVal={(n: GraphNode) => Math.log2(n.weight + 1) * 2 + 1}
            nodeColor={(n: GraphNode) => {
              const base = colorFor(n);
              if (!selected) return base;
              return isHighlighted(n.id) ? base : "rgba(120,120,130,0.15)";
            }}
            nodeLabel={(n: GraphNode) => `${n.label} · ${n.group}`}
            linkColor={(l: GraphLink) =>
              isLinkHighlighted(l) ? "rgba(180, 180, 200, 0.55)" : "rgba(120, 120, 130, 0.08)"
            }
            linkWidth={(l: GraphLink) => (isLinkHighlighted(l) && selected ? 1.4 : 0.6)}
            linkDirectionalParticles={0}
            cooldownTicks={120}
            d3AlphaDecay={0.025}
            d3VelocityDecay={0.35}
            onNodeClick={(n: GraphNode) => setSelected(n)}
            onBackgroundClick={() => setSelected(null)}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
              if (node.kind !== "entity") return;
              if (globalScale < 1.2) return;
              const label = node.label;
              const fontSize = Math.max(10, 12 / globalScale);
              ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
              ctx.fillStyle = "rgba(20,20,25,0.85)";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              const radius = Math.log2(node.weight + 1) * 2 + 1 + 4;
              ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + radius);
            }}
          />
        )}
      </div>

      {/* Header */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-3 rounded-lg border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
        <Network className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Knowledge Graph</h1>
        <div className="h-4 w-px bg-border" />
        <span className="text-xs text-muted-foreground">
          {nodeCounts.entities} entities · {nodeCounts.items} items · {nodeCounts.links} links
        </span>
      </div>

      {/* Top-right buttons */}
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 bg-background/90 backdrop-blur"
          onClick={() => setShowControls((s) => !s)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Controls
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 bg-background/90 backdrop-blur"
          onClick={loadData}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Controls panel */}
      {showControls && (
        <div className="absolute right-4 top-16 z-10 w-64 rounded-lg border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium">Top entities</label>
                <span className="text-xs text-muted-foreground">{entityLimit}</span>
              </div>
              <input
                type="range"
                min={10}
                max={200}
                step={10}
                value={entityLimit}
                onChange={(e) => setEntityLimit(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium">Items per entity</label>
                <span className="text-xs text-muted-foreground">{itemsPerEntity}</span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={itemsPerEntity}
                onChange={(e) => setItemsPerEntity(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Set to 0 for entity-only view
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      {data && data.nodes.length > 0 && (
        <div className="absolute bottom-4 left-4 z-10 max-w-xs rounded-lg border border-border bg-background/90 p-3 shadow-sm backdrop-blur">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Entities
          </p>
          <div className="flex flex-wrap gap-1.5">
            {groups.entities.map((g) => (
              <div key={g} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: ENTITY_COLORS[g] ?? "#a78bfa" }}
                />
                <span className="text-[11px] text-muted-foreground">{g}</span>
              </div>
            ))}
          </div>
          {groups.items.length > 0 && (
            <>
              <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Items
              </p>
              <div className="flex flex-wrap gap-1.5">
                {groups.items.map((g) => (
                  <div key={g} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorFor({ kind: "item", group: g } as GraphNode) }}
                    />
                    <span className="text-[11px] text-muted-foreground">{g}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Selected node panel */}
      {selected && (
        <div className="absolute right-4 top-16 bottom-4 z-10 flex w-96 flex-col rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <Badge variant="secondary" className="mb-1.5 text-[10px]">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: colorFor(selected) }}
                />
                {selected.kind} · {selected.group}
              </Badge>
              <p className="text-sm font-semibold leading-snug">{selected.label}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selected.kind === "entity"
                  ? `Observed ${selected.weight} time${selected.weight !== 1 ? "s" : ""}`
                  : `Linked to ${selected.weight} entit${selected.weight !== 1 ? "ies" : "y"}`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => setSelected(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {detailLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Loading details...
              </div>
            )}
            {detailError && (
              <p className="text-xs text-destructive">Failed to load details: {detailError}</p>
            )}

            {/* Entity detail */}
            {detail?.kind === "entity" && (
              <div className="space-y-3">
                {detail.data.description && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {detail.data.description}
                  </p>
                )}

                {detail.data.aliases.length > 0 && (
                  <DetailSection label="Aliases">
                    <div className="flex flex-wrap gap-1.5">
                      {detail.data.aliases.map((a) => (
                        <Badge key={a} variant="outline" className="text-[10px]">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </DetailSection>
                )}

                <DetailSection label="Activity">
                  <KeyValueRow k="First seen" v={formatDateTime(detail.data.created_at)} />
                  <KeyValueRow k="Last seen" v={formatDateTime(detail.data.last_seen_at)} />
                  <KeyValueRow
                    k="Times observed"
                    v={String(detail.data.mention_count)}
                  />
                  <KeyValueRow
                    k="Items extracted"
                    v={String(detail.data.items?.length ?? 0)}
                  />
                </DetailSection>

                {Object.keys(detail.data.metadata ?? {}).length > 0 && (
                  <DetailSection label="Metadata">
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground">
                      {JSON.stringify(detail.data.metadata, null, 2)}
                    </pre>
                  </DetailSection>
                )}

                <DetailSection
                  label={`Linked items (${detail.data.items?.length ?? 0})`}
                >
                  {!detail.data.items || detail.data.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No linked items.</p>
                  ) : (
                    <ul className="space-y-1">
                      {detail.data.items.map((it) => {
                        const graphNode = nodesById.get(it.id);
                        return (
                          <li key={it.id}>
                            <button
                              type="button"
                              disabled={!graphNode}
                              onClick={() => graphNode && setSelected(graphNode)}
                              className={cn(
                                "group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left",
                                graphNode
                                  ? "hover:border-border hover:bg-muted/50"
                                  : "cursor-default opacity-70",
                              )}
                            >
                              <span
                                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: colorFor({
                                    kind: "item",
                                    group: it.type,
                                  } as GraphNode),
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">
                                  {it.summary || it.content}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {it.type} · {it.status}
                                  {!graphNode && " · not in current graph view"}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </DetailSection>
              </div>
            )}

            {/* Item detail */}
            {detail?.kind === "item" && (
              <div className="space-y-3">
                <p className="whitespace-pre-wrap text-xs leading-relaxed">
                  {detail.data.content}
                </p>

                <DetailSection label="Properties">
                  <KeyValueRow k="Type" v={detail.data.type} />
                  <KeyValueRow k="Status" v={detail.data.status} />
                  <KeyValueRow k="Source" v={detail.data.source} />
                  <KeyValueRow k="Day" v={detail.data.day} />
                  <KeyValueRow k="Created" v={formatDateTime(detail.data.created_at)} />
                  <KeyValueRow k="Updated" v={formatDateTime(detail.data.updated_at)} />
                  <KeyValueRow
                    k="Reinforced"
                    v={formatDateTime(detail.data.last_reinforced_at)}
                  />
                  {detail.data.completed_at && (
                    <KeyValueRow k="Completed" v={formatDateTime(detail.data.completed_at)} />
                  )}
                </DetailSection>

                {Object.keys(detail.data.metadata ?? {}).length > 0 && (
                  <DetailSection label="Metadata">
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground">
                      {JSON.stringify(detail.data.metadata, null, 2)}
                    </pre>
                  </DetailSection>
                )}

                <DetailSection
                  label={`Linked entities (${selectedNeighbors?.length ?? 0})`}
                >
                  {!selectedNeighbors || selectedNeighbors.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No linked entities in view.</p>
                  ) : (
                    <ul className="space-y-1">
                      {selectedNeighbors.map(({ node, relationship }) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(node)}
                            className="group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-muted/50"
                          >
                            <span
                              className="mt-1 h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: colorFor(node) }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">{node.label}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {node.group}
                                {relationship && ` · ${relationship}`}
                              </p>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailSection>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty / loading / error states */}
      {loading && !data && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading graph...
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        </div>
      )}
      {data && data.nodes.length === 0 && !loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-muted-foreground">
          <Network className="mb-3 h-10 w-10" />
          <p className="text-sm font-medium">No knowledge yet</p>
          <p className="text-xs">Chat with Edda to start building your graph.</p>
        </div>
      )}
    </main>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function KeyValueRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate font-medium">{v}</span>
    </div>
  );
}
