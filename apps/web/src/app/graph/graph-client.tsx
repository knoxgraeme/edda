"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Network, RefreshCw, Settings2 } from "lucide-react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ControlsPanel } from "./controls-panel";
import { DetailsPanel } from "./details-panel";
import { GraphCanvas } from "./graph-canvas";
import {
  type EntityWithItems,
  type GraphData,
  type GraphLink,
  type GraphNode,
  type NodeDetail,
  linkEndId,
} from "./graph-types";
import { Legend } from "./legend";

import type { Item } from "@edda/db";

const DETAIL_CACHE_MAX = 50;

export function GraphClient() {
  // ──────────────────────────────────────────────
  // Data + parameter state
  // ──────────────────────────────────────────────
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityLimit, setEntityLimit] = useState(60);
  const [itemsPerEntity, setItemsPerEntity] = useState(8);

  // Selection / detail-panel state
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailCacheRef = useRef<Map<string, NodeDetail>>(new Map());

  // Whether the last selection came from an in-panel click-through.
  // When true we skip the camera focus because navigation is already implicit.
  const skipFocusRef = useRef(false);

  // Layout state
  const [showControls, setShowControls] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);

  // ──────────────────────────────────────────────
  // Data fetching
  // ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Clear the detail cache — it can hold items that are no longer in view,
    // which also keeps this cap from growing unbounded across refreshes.
    detailCacheRef.current.clear();
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

  // Fetch full details whenever the user selects a node.
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
        const body = (await res.json()) as EntityWithItems | Item;
        if (cancelled) return;
        const next: NodeDetail =
          selected.kind === "entity"
            ? { kind: "entity", data: body as EntityWithItems }
            : { kind: "item", data: body as Item };
        const cache = detailCacheRef.current;
        // Simple LRU cap: drop the oldest insertion when over limit.
        if (cache.size >= DETAIL_CACHE_MAX) {
          const firstKey = cache.keys().next().value;
          if (firstKey !== undefined) cache.delete(firstKey);
        }
        cache.set(cacheKey, next);
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

  // ──────────────────────────────────────────────
  // Layout: ResizeObserver keeps the canvas in sync with its container,
  // catching sidebar/devtools toggles the old window-resize listener missed.
  // ──────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ──────────────────────────────────────────────
  // Camera focus: center + zoom on the selected node once the sim has a
  // chance to place it. Skipped for click-through navigation from the
  // detail panel, because that would yank the viewport unexpectedly.
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    if (skipFocusRef.current) {
      skipFocusRef.current = false;
      return;
    }
    const g = graphRef.current;
    if (!g) return;

    const focus = () => {
      const x = selected.x;
      const y = selected.y;
      if (typeof x !== "number" || typeof y !== "number") return;
      g.centerAt(x, y, 500);
      g.zoom(3, 500);
    };

    // Give the force sim a frame to settle node positions before focusing.
    const raf = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(raf);
  }, [selected]);

  // ──────────────────────────────────────────────
  // Derived data (memoized)
  // ──────────────────────────────────────────────
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

  // Adjacency: node id -> map of neighbor id -> relationship label.
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
    // Entities first, then by weight descending.
    list.sort((a, b) => {
      if (a.node.kind !== b.node.kind) return a.node.kind === "entity" ? -1 : 1;
      return b.node.weight - a.node.weight;
    });
    return list;
  }, [selected, adjacency, nodesById]);

  // ──────────────────────────────────────────────
  // Highlighting predicates
  // ──────────────────────────────────────────────
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

  // Click-through navigation from inside the detail panel: mark the focus
  // effect to skip this selection so we don't yank the viewport.
  const selectFromPanel = useCallback((node: GraphNode) => {
    skipFocusRef.current = true;
    setSelected(node);
  }, []);

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────
  return (
    <main className="relative h-screen w-full overflow-hidden bg-background">
      <div ref={containerRef} className="absolute inset-0">
        {data && data.nodes.length > 0 && (
          <GraphCanvas
            ref={graphRef}
            data={data}
            width={dimensions.width}
            height={dimensions.height}
            selected={selected}
            isHighlighted={isHighlighted}
            isLinkHighlighted={isLinkHighlighted}
            onNodeClick={(n) => setSelected(n)}
            onBackgroundClick={() => setSelected(null)}
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

      {/* Top-right toolbar */}
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

      {showControls && (
        <ControlsPanel
          entityLimit={entityLimit}
          itemsPerEntity={itemsPerEntity}
          onEntityLimitChange={setEntityLimit}
          onItemsPerEntityChange={setItemsPerEntity}
        />
      )}

      {data && data.nodes.length > 0 && <Legend groups={groups} />}

      {selected && (
        <DetailsPanel
          selected={selected}
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          selectedNeighbors={selectedNeighbors}
          nodesById={nodesById}
          onSelect={selectFromPanel}
          onClose={() => setSelected(null)}
        />
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
