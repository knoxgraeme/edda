"use client";

import * as React from "react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, Play } from "lucide-react";
import type { TaskRun } from "../../../types/db";
import { RunSparkline } from "./run-sparkline";
import { Button } from "@/components/ui/button";
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
          "-mx-1 rounded-sm px-1 transition-colors hover:bg-muted/50",
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", statusColor(run.status))} aria-hidden />
        <span className="w-16 shrink-0 font-mono text-[0.7rem] text-muted-foreground">
          {run.trigger}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {run.output_summary || (run.error ? run.error : run.status)}
        </span>
        <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">
          {formatDuration(run.duration_ms)}
        </span>
        {run.tokens_used != null && (
          <span className="w-14 shrink-0 text-right font-mono text-[0.7rem] text-muted-foreground">
            {run.tokens_used.toLocaleString()}
          </span>
        )}
        <span className="w-20 shrink-0 text-right font-mono text-[0.7rem] text-muted-foreground">
          {run.started_at
            ? formatDistanceToNow(new Date(run.started_at), {
                addSuffix: false,
              })
            : "—"}
        </span>
      </button>
      {expanded && (run.output_summary || run.error) && (
        <div className="mb-2 ml-4 space-y-1.5 rounded-sm bg-muted/60 px-3 py-2 text-xs">
          {run.output_summary && (
            <div>
              <div className="section-eyebrow mb-0.5">Output</div>
              <p className="whitespace-pre-wrap">{run.output_summary}</p>
            </div>
          )}
          {run.error && (
            <div>
              <div className="section-eyebrow mb-0.5 !text-destructive">Error</div>
              <p className="whitespace-pre-wrap text-destructive">{run.error}</p>
            </div>
          )}
          <div className="flex gap-4 pt-1 font-mono text-[0.7rem] text-muted-foreground">
            {run.model && <span>{run.model}</span>}
            {run.input_summary && <span>in: {run.input_summary}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Runs timeline — lives in the chat pane as a peer tab to "Test agent".
 * Per the design, runs are runtime/observability and shouldn't mix
 * with configuration sections. Polling and fresh-data ownership is
 * handled by the parent (ChatPaneInner) so the Runs tab badge stays
 * live even when the user is on the Test tab.
 */
export function RunsPanel({
  runs,
  onRunNow,
}: {
  runs: TaskRun[];
  onRunNow?: () => void;
}) {
  const [sevenDaysAgo] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = runs.filter(
    (r) => r.started_at && new Date(r.started_at).getTime() >= sevenDaysAgo,
  );
  const totalTokens = recent.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

  if (runs.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-[360px] pt-12 text-center">
          <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mb-1 text-sm font-medium text-foreground">No runs yet</div>
          <p className="mb-4 text-[13px] text-muted-foreground">
            Runs will appear here when a schedule fires, a channel triggers the agent, or you press
            Run now.
          </p>
          {onRunNow && (
            <Button size="sm" variant="outline" onClick={onRunNow} className="gap-1">
              <Play className="h-3 w-3" />
              Run now
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <RunSparkline runs={runs} />
        <div className="text-right">
          <div className="text-lg font-semibold leading-none tabular-nums">{recent.length}</div>
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
    </div>
  );
}
