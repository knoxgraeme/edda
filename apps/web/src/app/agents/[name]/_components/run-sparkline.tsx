"use client";

import * as React from "react";
import type { TaskRun } from "../../../types/db";
import { cn } from "@/lib/utils";

/**
 * Compact SVG sparkline of token usage per run, oldest → newest.
 *
 * Renders a filled area path with a stroke on top. The draw-in
 * animation is driven by a CSS variable set from the computed path
 * length.
 */
export function RunSparkline({
  runs,
  width = 180,
  height = 36,
  className,
}: {
  runs: TaskRun[];
  width?: number;
  height?: number;
  className?: string;
}) {
  // Chronological order, filter to runs with a token count
  const series = React.useMemo(() => {
    const withTokens = runs
      .filter((r) => r.tokens_used != null && r.tokens_used > 0)
      .slice()
      .reverse(); // runs come newest-first, flip to oldest-first
    return withTokens;
  }, [runs]);

  const pathRef = React.useRef<SVGPathElement | null>(null);
  const [length, setLength] = React.useState<number>(200);

  React.useEffect(() => {
    if (pathRef.current) {
      setLength(pathRef.current.getTotalLength());
    }
  }, [series]);

  if (series.length < 2) {
    return (
      <div
        className={cn("flex items-center text-xs text-muted-foreground", className)}
        style={{ height }}
      >
        Not enough data
      </div>
    );
  }

  const values = series.map((r) => r.tokens_used ?? 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  // Leave 1px padding so the stroke doesn't clip.
  const pad = 1.5;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return { x, y };
  });

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  const area =
    `${line} L${points[points.length - 1].x.toFixed(2)},${(height - pad).toFixed(2)} ` +
    `L${points[0].x.toFixed(2)},${(height - pad).toFixed(2)} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block overflow-visible", className)}
      aria-label="Recent run token usage sparkline"
      role="img"
    >
      <path d={area} fill="var(--color-accent-warm)" fillOpacity={0.12} />
      <path
        ref={pathRef}
        d={line}
        fill="none"
        stroke="var(--color-accent-warm)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sparkline-path"
        style={{ ["--sparkline-length" as string]: `${length}` }}
      />
      {/* Last point dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={2}
        fill="var(--color-accent-warm)"
      />
    </svg>
  );
}
