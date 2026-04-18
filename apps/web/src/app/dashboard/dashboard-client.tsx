"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  Moon,
  Archive,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

import type {
  DashboardData,
  EnabledSchedule,
  Item,
  TaskRun,
} from "../types/db";
import { Section } from "@/app/components/section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCountdown, humanizeCron, nextRunAt } from "@/lib/cron";
import { formatDuration } from "@/lib/format";
import { updateItemStatusAction } from "../actions";
import { RunSparkline } from "../agents/[name]/_components/run-sparkline";


// ─── Signal dot ─────────────────────────────────────────────────

function statusDotClass(status: string): string {
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

// ─── Hero stat card ─────────────────────────────────────────────

function HeroStat({
  value,
  label,
  accent,
  href,
}: {
  value: number;
  label: string;
  accent?: boolean;
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex flex-col items-start gap-1 border-r border-border px-6 py-5 last:border-r-0",
        "transition-colors",
        href && "hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "text-5xl font-semibold leading-none tracking-tight",
          accent && value > 0 ? "text-accent-warm" : "text-foreground",
          value === 0 && "text-muted-foreground",
        )}
      >
        {value}
      </div>
      <div className="section-eyebrow">{label}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="flex-1 min-w-0">
      {body}
    </Link>
  ) : (
    <div className="flex-1 min-w-0">{body}</div>
  );
}

// ─── Item row ───────────────────────────────────────────────────

function ItemRow({
  item,
  showType,
}: {
  item: Item;
  showType?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const dueDate =
    typeof item.metadata?.due_date === "string"
      ? item.metadata.due_date
      : undefined;

  const act = (status: "done" | "snoozed" | "archived") => {
    startTransition(() => updateItemStatusAction(item.id, status));
  };

  return (
    <li className="group flex items-start gap-3 border-b border-border/60 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{item.content}</p>
        {(showType || dueDate || item.summary) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {showType && (
              <span className="font-mono text-[0.65rem] uppercase tracking-wide">
                {item.type.replace(/_/g, " ")}
              </span>
            )}
            {dueDate && <span>{dueDate}</span>}
            {item.summary && <span className="truncate">{item.summary}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={pending}
          title="Mark as complete"
          aria-label="Mark as complete"
          onClick={() => act("done")}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={pending}
          title="Snooze"
          aria-label="Snooze"
          onClick={() => act("snoozed")}
        >
          <Moon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={pending}
          title="Archive"
          aria-label="Archive"
          onClick={() => act("archived")}
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

// ─── Schedule forecast row ──────────────────────────────────────

function ScheduleForecastRow({
  schedule,
  now,
}: {
  schedule: EnabledSchedule;
  now: number;
}) {
  const next = useMemo(
    () => nextRunAt(schedule.cron, new Date(now)),
    [schedule.cron, now],
  );
  if (!next) return null;
  const delta = next.getTime() - now;

  return (
    <li>
      <Link
        href={`/agents/${schedule.agent_name}`}
        className="flex items-baseline gap-3 border-b border-border/60 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/30 -mx-6 px-6"
      >
        <span className="text-base font-medium text-foreground">
          {schedule.agent_name}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{schedule.name}</span>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {humanizeCron(schedule.cron)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {formatCountdown(delta)}
        </span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </Link>
    </li>
  );
}

// ─── Run row ────────────────────────────────────────────────────

function RunRow({ run }: { run: TaskRun }) {
  return (
    <li className="flex items-center gap-3 border-b border-border/60 py-2 text-xs last:border-0">
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDotClass(run.status))}
        aria-hidden
      />
      <Link
        href={`/agents/${run.agent_name}`}
        className="font-medium text-foreground hover:underline underline-offset-2"
      >
        {run.agent_name}
      </Link>
      <span className="font-mono text-muted-foreground">{run.trigger}</span>
      <span className="flex-1 min-w-0 truncate text-muted-foreground">
        {run.output_summary || run.error || run.status}
      </span>
      {run.duration_ms != null && (
        <span className="font-mono text-muted-foreground">
          {formatDuration(run.duration_ms)}
        </span>
      )}
      {run.started_at && (
        <span className="font-mono text-muted-foreground w-20 text-right">
          {formatDistanceToNow(new Date(run.started_at), { addSuffix: false })}
        </span>
      )}
    </li>
  );
}

// ─── Main ───────────────────────────────────────────────────────

export function DashboardClient({
  data,
  pendingCount,
  recentRuns,
  activeCount,
  schedules,
  latestRunPerAgent,
}: {
  data: DashboardData;
  pendingCount: number;
  recentRuns: TaskRun[];
  activeCount: number;
  schedules: EnabledSchedule[];
  latestRunPerAgent: Record<string, TaskRun>;
}) {
  const router = useRouter();

  // Shared clock for countdowns
  const [now, setNow] = React.useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Poll every 30s while tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  // Agents whose latest run is failed
  const failingAgents = useMemo(
    () =>
      Object.entries(latestRunPerAgent)
        .filter(([, run]) => run?.status === "failed")
        .map(([name]) => name),
    [latestRunPerAgent],
  );

  // 7-day rollup
  const [sevenDaysAgo] = React.useState(
    () => Date.now() - 7 * 24 * 60 * 60 * 1000,
  );
  const recentRuns7d = useMemo(
    () =>
      recentRuns.filter(
        (r) =>
          r.started_at && new Date(r.started_at).getTime() >= sevenDaysAgo,
      ),
    [recentRuns, sevenDaysAgo],
  );
  const totalTokens7d = useMemo(
    () => recentRuns7d.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0),
    [recentRuns7d],
  );

  // Schedules firing in next 24h, sorted by soonest
  const upcomingSchedules = useMemo(() => {
    const horizon = now + 24 * 60 * 60 * 1000;
    return schedules
      .filter((s) => s.enabled)
      .map((s) => {
        const next = nextRunAt(s.cron, new Date(now));
        return next ? { schedule: s, nextAt: next.getTime() } : null;
      })
      .filter((x): x is { schedule: EnabledSchedule; nextAt: number } => !!x)
      .filter((x) => x.nextAt <= horizon)
      .sort((a, b) => a.nextAt - b.nextAt)
      .map((x) => x.schedule);
  }, [schedules, now]);

  const listIds = Object.keys(data.lists);
  const today = format(new Date(), "EEEE, MMMM d");

  const jumpToConfirmations = useCallback(() => {
    router.push("/inbox");
  }, [router]);

  // Populated / quiet split — so empty sections collapse into a single
  // summary row at the bottom instead of eating full-section real estate.
  const hasDue = data.due_today.length > 0;
  const hasCaptured = data.captured_today.length > 0;
  const hasOpen = data.open_items.length > 0;
  const hasRuns = recentRuns.length > 0;
  const hasSchedules = upcomingSchedules.length > 0;
  const hasLists = listIds.length > 0;

  const quietAreas: string[] = [];
  if (!hasDue) quietAreas.push("nothing due today");
  if (!hasCaptured) quietAreas.push("nothing captured");
  if (!hasOpen) quietAreas.push("no open items");
  if (!hasRuns) quietAreas.push("no recent agent runs");

  return (
    <main className="flex h-full flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex shrink-0 items-baseline justify-between border-b border-border px-6 py-5">
        <div>
          <div className="section-eyebrow">overview</div>
          <h1 className="text-4xl font-bold leading-none tracking-tight">
            Today
          </h1>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{today}</p>
      </header>

      {/* ── Hero stat grid ─────────────────────────────────── */}
      <div className="flex shrink-0 border-b border-border">
        <HeroStat value={data.due_today.length} label="due today" />
        <HeroStat value={data.captured_today.length} label="captured" />
        <HeroStat value={data.open_items.length} label="open items" />
        <HeroStat
          value={activeCount}
          label="running now"
          accent={activeCount > 0}
        />
        <HeroStat
          value={pendingCount}
          label="pending review"
          accent={pendingCount > 0}
          href={pendingCount > 0 ? "/inbox" : undefined}
        />
      </div>

      {/* ── Failing run banner ─────────────────────────────── */}
      {failingAgents.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-destructive/5 px-6 py-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {failingAgents.length === 1
              ? `${failingAgents[0]} is failing.`
              : `${failingAgents.length} agents are failing: ${failingAgents.join(", ")}.`}
          </span>
          <Link
            href={`/agents/${failingAgents[0]}`}
            className="ml-auto underline underline-offset-2 hover:no-underline"
          >
            investigate →
          </Link>
        </div>
      )}

      {/* ── Pending confirmations banner ───────────────────── */}
      {pendingCount > 0 && failingAgents.length === 0 && (
        <button
          type="button"
          onClick={jumpToConfirmations}
          className="flex items-center gap-2 border-b border-border bg-accent-warm/5 px-6 py-2.5 text-left text-xs text-accent-warm transition-colors hover:bg-accent-warm/10"
        >
          <span className="section-eyebrow !text-accent-warm">
            needs your review
          </span>
          <span>
            {pendingCount} {pendingCount === 1 ? "confirmation" : "confirmations"}{" "}
            pending
          </span>
          <span className="ml-auto underline underline-offset-2">
            review in inbox →
          </span>
        </button>
      )}

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Due today (only if populated) */}
        {hasDue && (
          <Section eyebrow={`Due today · ${data.due_today.length}`} delay={0}>
            <ul>
              {data.due_today.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          </Section>
        )}

        {/* Schedules — next 24h */}
        {hasSchedules && (
          <Section
            eyebrow={`Schedules · next 24h · ${upcomingSchedules.length}`}
            delay={40}
          >
            <ul>
              {upcomingSchedules.map((s) => (
                <ScheduleForecastRow key={s.id} schedule={s} now={now} />
              ))}
            </ul>
          </Section>
        )}

        {/* Agent activity (only if runs exist) */}
        {hasRuns && (
          <Section eyebrow="Agent activity · last 7d" delay={80}>
            <div className="mb-3 flex items-end justify-between gap-3">
              <RunSparkline runs={recentRuns} />
              <div className="text-right">
                <div className="text-lg font-semibold leading-none tabular-nums">
                  {recentRuns7d.length}
                </div>
                <div className="section-eyebrow !tracking-tight">
                  runs · {totalTokens7d.toLocaleString()} tok
                </div>
              </div>
            </div>
            <ul>
              {recentRuns.slice(0, 5).map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
            {recentRuns.length > 5 && (
              <Link
                href="/agents"
                className="mt-2 inline-block text-[0.7rem] text-muted-foreground hover:text-foreground"
              >
                View all agent activity →
              </Link>
            )}
          </Section>
        )}

        {/* Captured today (only if populated) */}
        {hasCaptured && (
          <Section
            eyebrow={`Captured today · ${data.captured_today.length}`}
            delay={120}
          >
            <ul>
              {data.captured_today.map((item) => (
                <ItemRow key={item.id} item={item} showType />
              ))}
            </ul>
          </Section>
        )}

        {/* Open items (only if populated) */}
        {hasOpen && (
          <Section
            eyebrow={`Open items · ${data.open_items.length}`}
            delay={160}
          >
            <ul>
              {data.open_items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          </Section>
        )}

        {/* Lists */}
        {hasLists && (
          <Section eyebrow={`Lists · ${listIds.length}`} delay={200}>
            <ul>
              {listIds.map((listId) => {
                const { list, items } = data.lists[listId];
                return (
                  <li
                    key={listId}
                    className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-0"
                  >
                    <span>{list.icon}</span>
                    <span className="text-foreground">{list.name}</span>
                    <div className="flex-1" />
                    <span className="font-mono text-xs text-muted-foreground">
                      {items.length} {items.length === 1 ? "item" : "items"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {/* ── Quiet areas summary ───────────────────────────── */}
        {quietAreas.length > 0 && (
          <div className="rise-in border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="section-eyebrow">all quiet</span>
              <span className="text-xs text-muted-foreground">
                {quietAreas.join(" · ")}
              </span>
            </div>
          </div>
        )}

        {/* ── All-clear hero state ──────────────────────────── */}
        {!hasDue &&
          !hasCaptured &&
          !hasOpen &&
          !hasRuns &&
          !hasSchedules &&
          !hasLists &&
          pendingCount === 0 &&
          failingAgents.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-2xl font-medium text-muted-foreground tracking-tight">
                All caught up.
              </p>
              <p className="text-xs text-muted-foreground">
                Capture something in chat to see it here.
              </p>
            </div>
          )}
      </div>
    </main>
  );
}
