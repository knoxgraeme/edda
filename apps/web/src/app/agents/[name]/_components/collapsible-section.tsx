"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible section for the agent config panel.
 *
 *  ┌ ▸ EYEBROW  [count]   inline summary when closed          [action]
 *  │  ─────────────────
 *  │  children (only when open)
 *
 * Closed rows show a compact inline `summary` so users can scan the
 * whole config without expanding anything. Opening reveals full
 * contents indented under the eyebrow.
 */
export function CollapsibleSection({
  eyebrow,
  count,
  summary,
  action,
  defaultOpen = false,
  children,
  className,
  delay = 0,
}: {
  eyebrow: string;
  count?: number | string;
  summary?: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <section
      className={cn("rise-in border-b border-border", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <div
        className="flex cursor-pointer items-center gap-2.5 px-6 py-3.5 hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform shrink-0",
            open && "rotate-90",
          )}
        />
        <div className="section-eyebrow shrink-0">{eyebrow}</div>
        {count !== undefined && count !== null && (
          <span className="inline-flex h-[17px] min-w-[18px] items-center justify-center rounded-sm bg-muted px-1.5 font-mono text-[11px] font-semibold text-muted-foreground">
            {count}
          </span>
        )}
        {!open && summary !== undefined && (
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
            {summary}
          </div>
        )}
        {action && (
          <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}
      </div>
      {open && <div className="px-6 pb-5 pl-[44px]">{children}</div>}
    </section>
  );
}

/** A pill inside a collapsible summary — mono, muted. */
export function SummaryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">
      {children}
    </span>
  );
}

/** A plain text bit inside a collapsible summary (optionally with a status dot). */
export function SummaryText({
  children,
  status,
}: {
  children: React.ReactNode;
  status?: "ok" | "run" | "fail" | "muted";
}) {
  const bg =
    status === "ok"
      ? "bg-signal-ok"
      : status === "run"
        ? "bg-signal-run"
        : status === "fail"
          ? "bg-signal-fail"
          : "bg-muted-foreground/40";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {status && <span className={cn("h-1.5 w-1.5 rounded-full", bg)} />}
      {children}
    </span>
  );
}
