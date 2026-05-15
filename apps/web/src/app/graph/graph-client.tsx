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
  ENTITY_TYPE_VALUES,
  type EntityType,
  type EntityWithItems,
  type GraphData,
  type GraphLink,
  type GraphNode,
  type Item,
  type NodeDetail,
  linkEndId,
} from "./graph-types";
import { Legend } from "./legend";
import { SearchInput } from "./search-input";

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
  const [minItemLinks, setMinItemLinks] = useState(1);
  const [selectedTypes, setSelectedTypes] = useState<Set<EntityType>>(
    () => new Set(ENTITY_TYPE_VALUES),
  );
  // Force-simulation tuning knobs. d3-force defaults: charge=-30, linkDistance=30.
  // More negative charge → stronger node repulsion → more spread.
  const [chargeStrength, setChargeStrength] = useState(-30);
  const [linkDistance, setLinkDistance] = useState(30);
  // Draft vs committed search: draft updates on every keystroke, searchQuery
  // is committed 300ms after the last change via the debounce effect below.
  const [draftSearch, setDraftSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

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
    // Detail cache is intentionally NOT cleared here — previously-fetched
    // entity/item records are still valid across slider adjustments, and the
    // FIFO cap in the selection effect keeps memory bounded. Manual Refresh
    // is the only way to force re-fetch, which is rare.

    // Zero types selected: deliberate empty state, no request needed.
    if (selectedTypes.size === 0) {
      setData({ nodes: [], links: [] });
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({
        entities: String(entityLimit),
        items: String(itemsPerEntity),
      });
      // Only send `types` when it's a strict subset — omitting the param
      // means "all types" on the backend, which matches our default.
      if (selectedTypes.size < ENTITY_TYPE_VALUES.length) {
        params.set("types", Array.from(selectedTypes).join(","));
      }
      const trimmed = searchQuery.trim();
      if (trimmed) params.set("search", trimmed);
      // Only send `min_links` when non-default (>1) to keep URLs clean.
      if (minItemLinks > 1) params.set("min_links", String(minItemLinks));
      const res = await fetch(`/api/v1/graph?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GraphData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [entityLimit, itemsPerEntity, minItemLinks, selectedTypes, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Debounce `draftSearch` -> `searchQuery` by 300ms so a burst of keystrokes
  // collapses to a single API request once the user stops typing.
  useEffect(() => {
    if (draftSearch === searchQuery) return;
    const t = setTimeout(() => setSearchQuery(draftSearch), 300);
    return () => clearTimeout(t);
  }, [draftSearch, searchQuery]);

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
        ? `/api/v1/entities/${selected.id}?expand=items&items_limit=20`
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
  // Force tuning: apply charge/link parameters to d3-force and reheat the
  // simulation. Runs on every change OR when the graph is rebuilt (so new
  // nodes pick up the current settings).
  // ──────────────────────────────────────────────
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !data || data.nodes.length === 0) return;
    // react-force-graph's `d3Force(name)` returns the underlying d3-force
    // instance; we use the fluent setters to tune.
    const charge = g.d3Force("charge") as
      | { strength: (v: number) => unknown }
      | null
      | undefined;
    charge?.strength(chargeStrength);
    const link = g.d3Force("link") as
      | { distance: (v: number) => unknown }
      | null
      | undefined;
    link?.distance(linkDistance);
    g.d3ReheatSimulation();
  }, [chargeStrength, linkDistance, data]);

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
      // x/y are populated by the force simulation. On graph-click selections
      // they're always defined. The only path where they might be undefined
      // is programmatic selection of a node that hasn't been placed yet
      // (e.g. future deep-linking via URL). Bail silently in that case —
      // user can click again once the sim has run.
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
    if (!data) return { entities: 0, items: 0, links: 0, hidden: 0 };
    let e = 0;
    let i = 0;
    for (const n of data.nodes) {
      if (n.kind === "entity") e++;
      else i++;
    }
    return {
      entities: e,
      items: i,
      links: data.links.length,
      hidden: data.stats?.items_hidden_by_min_links ?? 0,
    };
  }, [data]);

  /** Any non-default filter active? Used to indicate "viewing a slice". */
  const filterActive =
    minItemLinks > 1 ||
    searchQuery.trim() !== "" ||
    selectedTypes.size < ENTITY_TYPE_VALUES.length;

  const resetFilters = useCallback(() => {
    setMinItemLinks(1);
    setDraftSearch("");
    setSearchQuery("");
    setSelectedTypes(new Set(ENTITY_TYPE_VALUES));
  }, []);

  /** Per-type entity counts in the *current* view (used for pill labels). */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!data) return counts;
    for (const n of data.nodes) {
      if (n.kind !== "entity") continue;
      counts[n.group] = (counts[n.group] ?? 0) + 1;
    }
    return counts;
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
  //
  // Ordering invariant: React batches the `setSelected` state update, and the
  // camera-focus effect runs once per commit. Since we set `skipFocusRef`
  // synchronously before `setSelected`, the effect for THIS selection always
  // sees the flag as `true` and resets it. Concurrent canvas clicks don't
  // double-consume the flag because React coalesces into one commit per tick.
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
        <SearchInput
          value={draftSearch}
          onChange={setDraftSearch}
          placeholder="Search entities..."
          className="w-[200px]"
        />
        <div className="h-4 w-px bg-border" />
        <span className="text-xs text-muted-foreground">
          {nodeCounts.entities} entities · {nodeCounts.items} items
          {nodeCounts.hidden > 0 && (
            <span
              className="text-amber-500/80"
              title={`${nodeCounts.hidden} items hidden by the "min item connections" filter. Lower it to show them.`}
            >
              {" "}
              ({nodeCounts.hidden} hidden)
            </span>
          )}{" "}
          · {nodeCounts.links} links
        </span>
        {filterActive && (
          <>
            <div className="h-4 w-px bg-border" />
            <button
              type="button"
              onClick={resetFilters}
              className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20"
              title="One or more filters are active. Click to reset."
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Filtered · reset
            </button>
          </>
        )}
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
          minItemLinks={minItemLinks}
          chargeStrength={chargeStrength}
          linkDistance={linkDistance}
          onEntityLimitChange={setEntityLimit}
          onItemsPerEntityChange={setItemsPerEntity}
          onMinItemLinksChange={setMinItemLinks}
          onChargeStrengthChange={setChargeStrength}
          onLinkDistanceChange={setLinkDistance}
          selectedTypes={selectedTypes}
          onSelectedTypesChange={setSelectedTypes}
          typeCounts={typeCounts}
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
          {searchQuery.trim() ? (
            <>
              <p className="text-sm font-medium">No matching entities</p>
              <p className="text-xs">Try a different query.</p>
            </>
          ) : selectedTypes.size < ENTITY_TYPE_VALUES.length ? (
            <>
              <p className="text-sm font-medium">No entities match the current filter</p>
              <p className="text-xs">Try selecting more types.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">No knowledge yet</p>
              <p className="text-xs">Chat with Edda to start building your graph.</p>
            </>
          )}
        </div>
      )}
    </main>
  );
}
