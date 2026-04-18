"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Section primitive — the editorial "Mission Control" section.
 *
 * Layout:
 *   ┌─ sticky eyebrow bar                      [action]
 *   │  EYEBROW (small-caps)
 *   │  Heading (display serif, optional)
 *   │  ─────────────────────────
 *   │  children
 *
 * Sections stack vertically with hairline dividers between them. The
 * eyebrow header pins to the top of its scroll container as you scroll
 * past.
 *
 * Used by /agents/[name] (Mission Control) and /inbox.
 * Shared primitive — keep app-wide.
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
            <h2 className="mt-0.5 text-xl font-semibold leading-tight tracking-tight text-foreground">
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
