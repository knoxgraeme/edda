"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { TaskRun } from "../../../types/db";
import { Section } from "@/app/components/section";
import { RunSparkline } from "./run-sparkline";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-signal-ok";
    case "running":
    case "pending":
      return "bg-signal-run signal-dot-run";
    default:
      return "bg-signal-fail";
  }
}

function RunRow({ run }: { run: TaskRun }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 py-2 text-left text-xs",
          "hover:bg-muted/50 rounded-sm -mx-1 px-1 transition-colors",
        )}
      >
        <span
          className={cn("h-1.5 w-1.5 rounded-full", statusColor(run.status))}
          aria-hidden
        />
        <span className="font-mono text-[0.7rem] text-muted-foreground shrink-0 w-16">
          {run.trigger}
        </span>
        <span className="flex-1 min-w-0 truncate text-muted-foreground">
          {run.output_summary || (run.error ? run.error : run.status)}
        </span>
        <span className="font-mono text-[0.7rem] text-muted-foreground shrink-0">
          {formatDuration(run.duration_ms)}
        </span>
        {run.tokens_used != null && (
          <span className="font-mono text-[0.7rem] text-muted-foreground shrink-0 w-14 text-right">
            {run.tokens_used.toLocaleString()}
          </span>
        )}
        <span className="font-mono text-[0.7rem] text-muted-foreground shrink-0 w-20 text-right">
          {run.started_at
            ? formatDistanceToNow(new Date(run.started_at), {
                addSuffix: false,
              })
            : "—"}
        </span>
      </button>
      {expanded && (run.output_summary || run.error) && (
        <div className="ml-4 mb-2 rounded-sm bg-muted/60 px-3 py-2 text-xs space-y-1.5">
          {run.output_summary && (
            <div>
              <div className="section-eyebrow mb-0.5">Output</div>
              <p className="whitespace-pre-wrap">{run.output_summary}</p>
            </div>
          )}
          {run.error && (
            <div>
              <div className="section-eyebrow mb-0.5 !text-destructive">
                Error
              </div>
              <p className="whitespace-pre-wrap text-destructive">
                {run.error}
              </p>
            </div>
          )}
          <div className="flex gap-4 text-[0.7rem] text-muted-foreground font-mono pt-1">
            {run.model && <span>{run.model}</span>}
            {run.input_summary && <span>in: {run.input_summary}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

export function RunsPanel({
  agentName,
  runs: initialRuns,
  delay = 0,
}: {
  agentName: string;
  runs: TaskRun[];
  delay?: number;
}) {
  const [runs, setRuns] = useState(initialRuns);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentName)}/runs?limit=20`,
      );
      if (res.ok) {
        const data = await res.json();
        setRuns(Array.isArray(data) ? data : data.data);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development")
        console.warn("Runs polling failed:", err);
    }
  }, [agentName]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchRuns();
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchRuns();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchRuns]);

  // 7-day aggregates. Anchor to mount time so the rollup is stable across
  // re-renders (react-hooks/purity doesn't allow raw Date.now() during render).
  const [sevenDaysAgo] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = runs.filter(
    (r) => r.started_at && new Date(r.started_at).getTime() >= sevenDaysAgo,
  );
  const totalTokens = recent.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

  return (
    <Section eyebrow="Recent runs" delay={delay}>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 mb-3">
            <RunSparkline runs={runs} />
            <div className="text-right">
              <div className="text-lg font-semibold leading-none tabular-nums">
                {recent.length}
              </div>
              <div className="section-eyebrow !tracking-tight">
                runs / 7d · {totalTokens.toLocaleString()} tok
              </div>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {runs.slice(0, 20).map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
