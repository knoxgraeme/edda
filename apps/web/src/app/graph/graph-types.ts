import type { Entity, Item } from "@edda/db";

/**
 * Shared types and helpers for the /graph knowledge-graph page.
 *
 * NOTE: these are type-only imports from @edda/db — the `'use client'`
 * components that consume them will only import types, not runtime code.
 */

// ──────────────────────────────────────────────
// Graph node / link shapes (matches /api/v1/graph response)
// ──────────────────────────────────────────────

export interface GraphNode {
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
  // Populated by the force simulation after layout runs.
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relationship?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ──────────────────────────────────────────────
// Detail-panel payloads (reuse @edda/db types)
// ──────────────────────────────────────────────

/** Response shape of GET /api/v1/entities/{id}?expand=items&items_limit=N. */
export type EntityWithItems = Entity & { items?: Item[] };

export type NodeDetail =
  | { kind: "entity"; data: EntityWithItems }
  | { kind: "item"; data: Item };

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

export const ENTITY_COLORS: Record<string, string> = {
  person: "#f59e0b",
  project: "#3b82f6",
  company: "#8b5cf6",
  topic: "#10b981",
  place: "#ef4444",
  tool: "#06b6d4",
  concept: "#ec4899",
};

/** Color for a graph node: entity types use the palette, items hash to an HSL hue. */
export function colorFor(node: Pick<GraphNode, "kind" | "group">): string {
  if (node.kind === "entity") return ENTITY_COLORS[node.group] ?? "#a78bfa";
  let hash = 0;
  for (let i = 0; i < node.group.length; i++) {
    hash = (hash * 31 + node.group.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 65%)`;
}

/**
 * Visual size tuning for the force graph.
 *
 * `react-force-graph-2d` computes rendered radius as:
 *   radius_px = Math.sqrt(nodeVal) * nodeRelSize
 *
 * We want hubs (weight ~30) to be visibly dominant (~13-14 px) while leaves
 * (weight 1) stay small (~4 px), on a 60-node graph that fits the viewport
 * without overlap.
 *
 * Concretely with NODE_REL_SIZE = 2.5:
 *   weight 1  → sqrt(1)  * 2.5 = 2.5  → clamped to NODE_MIN_RADIUS = 4
 *   weight 8  → sqrt(8)  * 2.5 = 7.07
 *   weight 32 → sqrt(32) * 2.5 = 14.14
 */
export const NODE_REL_SIZE = 2.5;
const NODE_MIN_RADIUS = 4;

/** `nodeVal` passed to ForceGraph2D. Scalar — library takes sqrt and multiplies. */
export function nodeVal(node: Pick<GraphNode, "weight">): number {
  return Math.max(1, node.weight);
}

/** Rendered radius in CSS px, matching force-graph's internal computation. */
export function nodeRadius(node: Pick<GraphNode, "weight">): number {
  return Math.max(NODE_MIN_RADIUS, Math.sqrt(nodeVal(node)) * NODE_REL_SIZE);
}

export function linkEndId(end: string | GraphNode): string {
  return typeof end === "string" ? end : end.id;
}

export function formatDateTime(iso: string | null | undefined): string {
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
