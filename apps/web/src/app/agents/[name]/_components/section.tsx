"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Section primitive for the Mission Control right rail.
 *
 * Layout:
 *   ┌─ vertical rule                           [action]
 *   │  EYEBROW (small-caps)
 *   │  Heading (display serif, optional)
 *   │  ─────────────────────────
 *   │  children
 *
 * Sections stack vertically with hairline dividers between them.
 */
export function Section({
  eyebrow,
  title,
  action,
  children,
  className,
  delay = 0,
}: {
  eyebrow: string;
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Stagger delay (ms) for the page-load reveal animation. */
  delay?: number;
}) {
  return (
    <section
      className={cn(
        "rise-in relative border-b border-border",
        className,
      )}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {/* Sticky header pins to the top of the scroll container. The
          backdrop blur lets content peek through as it scrolls past. */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-background/85 backdrop-blur-sm border-b border-border/40 px-6 py-3">
        <div className="min-w-0">
          <div className="section-eyebrow">{eyebrow}</div>
          {title && (
            <h2 className="font-display text-xl leading-tight text-foreground mt-0.5">
              {title}
            </h2>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-6 py-4">{children}</div>
    </section>
  );
}

/** Row of key/value data, mono-aligned. */
export function DataRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-3 py-1.5 text-sm",
        className,
      )}
    >
      <span className="section-eyebrow !normal-case !tracking-normal w-28 shrink-0">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
