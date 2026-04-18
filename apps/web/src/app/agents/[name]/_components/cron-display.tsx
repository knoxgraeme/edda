"use client";

import * as React from "react";
import { humanizeCron, nextRunAt, formatCountdown } from "@/lib/cron";
import { cn } from "@/lib/utils";

/**
 * Two-line cron display.
 *
 *   Sun at 3:00 AM          (humanized)
 *   in 4d 6h  ·  0 3 * * 0  (countdown + raw mono)
 *
 * The countdown updates every 30 seconds via a shared ticker.
 */
export function CronDisplay({ expression, className }: { expression: string; className?: string }) {
  const human = humanizeCron(expression);
  const isVerbatim = human === expression;

  // Tick every 30s so the countdown stays fresh without thrashing.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = React.useMemo(() => nextRunAt(expression, new Date(now)), [expression, now]);
  const countdown = next ? formatCountdown(next.getTime() - now) : null;

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {!isVerbatim && <span className="text-sm text-foreground">{human}</span>}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {countdown && <span>{countdown}</span>}
        {countdown && <span aria-hidden>·</span>}
        <code className="font-mono text-[0.7rem]">{expression}</code>
      </div>
    </div>
  );
}
