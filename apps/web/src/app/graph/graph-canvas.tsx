"use client";

import { forwardRef, type ComponentType, type Ref } from "react";
import dynamic from "next/dynamic";
import type { ForceGraphMethods } from "react-force-graph-2d";

import {
  type GraphData,
  type GraphLink,
  type GraphNode,
  NODE_REL_SIZE,
  colorFor,
  nodeRadius,
  nodeVal as computeNodeVal,
} from "./graph-types";

/** Max characters for an entity's canvas label before truncation. */
const LABEL_MAX_CHARS = 32;

function truncateLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? label.slice(0, LABEL_MAX_CHARS - 1) + "…" : label;
}

// ──────────────────────────────────────────────
// Typed wrapper around the dynamically-imported component
// ──────────────────────────────────────────────

/**
 * Narrow prop interface with just the fields we actually use. `next/dynamic`
 * erases the generic types of `react-force-graph-2d`, so we cast the dynamic
 * import to this shape rather than using a lax `Record<string, unknown>`.
 */
interface ForceGraphProps {
  ref?: Ref<ForceGraphMethods<GraphNode, GraphLink> | undefined>;
  graphData: GraphData;
  width?: number;
  height?: number;
  backgroundColor?: string;
  nodeRelSize?: number;
  nodeVal?: number | ((node: GraphNode) => number);
  nodeColor?: string | ((node: GraphNode) => string);
  nodeLabel?: string | ((node: GraphNode) => string);
  linkColor?: string | ((link: GraphLink) => string);
  linkWidth?: number | ((link: GraphLink) => number);
  linkDirectionalParticles?: number;
  cooldownTicks?: number;
  d3AlphaDecay?: number;
  d3VelocityDecay?: number;
  onNodeClick?: (node: GraphNode) => void;
  onBackgroundClick?: () => void;
  nodeCanvasObjectMode?: () => "before" | "after" | "replace";
  nodeCanvasObject?: (
    node: GraphNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
}

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as ComponentType<ForceGraphProps>;

// ──────────────────────────────────────────────
// GraphCanvas
// ──────────────────────────────────────────────

interface GraphCanvasProps {
  data: GraphData;
  width: number;
  height: number;
  selected: GraphNode | null;
  isHighlighted: (nodeId: string) => boolean;
  isLinkHighlighted: (link: GraphLink) => boolean;
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
}

/** Canvas-side ring color for the selected node. */
const SELECTED_RING_COLOR = "#f59e0b";

export const GraphCanvas = forwardRef<
  ForceGraphMethods<GraphNode, GraphLink> | undefined,
  GraphCanvasProps
>(function GraphCanvas(
  {
    data,
    width,
    height,
    selected,
    isHighlighted,
    isLinkHighlighted,
    onNodeClick,
    onBackgroundClick,
  },
  ref,
) {
  return (
    <ForceGraph2D
      ref={ref}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="transparent"
      nodeRelSize={NODE_REL_SIZE}
      nodeVal={computeNodeVal}
      nodeColor={(n) => {
        const base = colorFor(n);
        if (!selected) return base;
        return isHighlighted(n.id) ? base : "rgba(120,120,130,0.15)";
      }}
      nodeLabel={(n) => `${n.label} · ${n.group}`}
      linkColor={(l) =>
        isLinkHighlighted(l) ? "rgba(180, 180, 200, 0.55)" : "rgba(120, 120, 130, 0.08)"
      }
      linkWidth={(l) => (isLinkHighlighted(l) && selected ? 1.4 : 0.6)}
      linkDirectionalParticles={0}
      cooldownTicks={120}
      d3AlphaDecay={0.025}
      d3VelocityDecay={0.35}
      onNodeClick={(n) => onNodeClick(n)}
      onBackgroundClick={() => onBackgroundClick()}
      nodeCanvasObjectMode={() => "after"}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const radius = nodeRadius(node);
        const x = node.x ?? 0;
        const y = node.y ?? 0;

        // Selected node: draw a bright 2px ring on top of the node circle.
        if (selected && node.id === selected.id) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
          ctx.lineWidth = 2 / globalScale;
          ctx.strokeStyle = SELECTED_RING_COLOR;
          ctx.stroke();
        }

        // Entity labels are always visible. Font is ~10px on screen regardless
        // of zoom (9 / globalScale = 9 world-unit px that render ~9 screen px
        // at any zoom), with a floor to prevent hair-thin text when zoomed in.
        // Item labels stay off — tooltip via `nodeLabel` shows them on hover.
        if (node.kind !== "entity") return;
        const fontSize = Math.max(3, 9 / globalScale);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        // Dark outline under a light fill so labels read against both the
        // dark background and any graph edges they cross.
        const text = truncateLabel(node.label);
        ctx.lineWidth = 3 / globalScale;
        ctx.strokeStyle = "rgba(10, 10, 15, 0.85)";
        ctx.strokeText(text, x, y + radius + 2);
        ctx.fillStyle = "rgba(235, 235, 240, 0.95)";
        ctx.fillText(text, x, y + radius + 2);
      }}
    />
  );
});
