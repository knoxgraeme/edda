"use client";

import * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Bot, Play, Plus, Search } from "lucide-react";

import type { Agent, AgentSchedule, EnabledSchedule, TaskRun } from "../types/db";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatCountdown, humanizeCron, nextRunAt } from "@/lib/cron";
import { NewAgentModal } from "./_components/new-agent-modal";

interface Props {
  agents: Agent[];
  lastRuns: Record<string, TaskRun | null>;
  schedules: EnabledSchedule[];
  sparklines: Record<string, number[]>;
  defaultAgent: string;
}

type Filter = "all" | "scheduled" | "on-demand" | "disabled";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "on-demand", label: "On-demand" },
  { id: "disabled", label: "Disabled" },
];

// ─── Run-now dialog ────────────────────────────────────────────────

function RunDialog({
  open,
  onOpenChange,
  agentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (!open) setPrompt("");
  }, [open]);

  const submit = async () => {
    if (!agentName || !prompt.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentName)}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            notify: ["inbox"],
          }),
        },
      );
      if (res.ok) {
        toast.success(`${agentName} triggered`);
        onOpenChange(false);
      } else {
        toast.error(`Failed to trigger ${agentName}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            Run {agentName}
          </DialogTitle>
          <DialogDescription>
            Ephemeral run. Result delivered to inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label htmlFor="fleet-run-prompt" className="sr-only">
            Prompt
          </Label>
          <textarea
            id="fleet-run-prompt"
            className="min-h-[120px] w-full rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="What should the agent do?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !prompt.trim()}
            className="gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            {submitting ? "Running…" : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cells ────────────────────────────────────────────────────────

function statusColor(status: TaskRun["status"] | undefined) {
  switch (status) {
    case "completed":
      return "bg-signal-ok";
    case "running":
    case "pending":
      return "bg-signal-run signal-dot-run";
    case "failed":
      return "bg-signal-fail";
    default:
      return "bg-border";
  }
}

function LastRunCell({ lastRun }: { lastRun: TaskRun | null | undefined }) {
  if (!lastRun?.started_at) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusColor(lastRun.status))}
        aria-hidden
      />
      <span className="truncate text-[12.5px] text-foreground">
        {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })}
      </span>
    </div>
  );
}

function NextRunCell({ schedules }: { schedules: AgentSchedule[] }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = useMemo(() => {
    let soonest: { at: Date; sched: AgentSchedule } | null = null;
    for (const s of schedules) {
      if (!s.enabled) continue;
      const at = nextRunAt(s.cron, new Date(now));
      if (at && (!soonest || at.getTime() < soonest.at.getTime())) {
        soonest = { at, sched: s };
      }
    }
    return soonest;
  }, [schedules, now]);

  if (!next) {
    return <span className="text-[12.5px] text-muted-foreground">On demand</span>;
  }

  return (
    <div className="min-w-0 truncate text-[12.5px] text-foreground">
      {humanizeCron(next.sched.cron)}{" "}
      <span className="font-mono text-[11.5px] text-muted-foreground">
        · {formatCountdown(next.at.getTime() - now)}
      </span>
    </div>
  );
}

function Sparkline({ runs, enabled }: { runs: number[]; enabled: boolean }) {
  const max = Math.max(1, ...runs);
  return (
    <div className="flex h-4 items-end gap-[2px]" aria-hidden>
      {runs.map((v, i) => {
        const h = v === 0 ? 2 : Math.max(3, Math.round((v / max) * 14));
        const bg =
          v === 0
            ? "bg-border"
            : enabled
              ? "bg-neutral-700 dark:bg-neutral-300"
              : "bg-neutral-300 dark:bg-neutral-600";
        return (
          <div
            key={i}
            className={cn("w-[3px] rounded-[1px]", bg)}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────

function PageHeader({
  total,
  enabledCount,
  query,
  setQuery,
  filter,
  setFilter,
  onNew,
}: {
  total: number;
  enabledCount: number;
  query: string;
  setQuery: (v: string) => void;
  filter: Filter;
  setFilter: (v: Filter) => void;
  onNew: () => void;
}) {
  return (
    <div className="border-b border-border px-6 pt-5 pb-3">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight whitespace-nowrap">
            Agents
          </h1>
          <span className="font-mono text-[12.5px] text-muted-foreground whitespace-nowrap">
            {enabledCount}/{total} enabled
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-[180px] pl-8 text-[13px]"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 whitespace-nowrap"
            onClick={onNew}
          >
            <Plus className="h-3.5 w-3.5" />
            New agent
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-[26px] rounded px-2.5 text-xs whitespace-nowrap transition-colors",
                on
                  ? "bg-secondary font-medium text-foreground"
                  : "font-normal text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────

const GRID_COLS =
  "grid grid-cols-[minmax(180px,2fr)_minmax(130px,1.1fr)_minmax(120px,1fr)_44px_64px] items-center gap-3 px-5";

function AgentRow({
  agent,
  isDefault,
  lastRun,
  schedules,
  runs,
  onRun,
  onOpen,
}: {
  agent: Agent;
  isDefault: boolean;
  lastRun: TaskRun | null | undefined;
  schedules: AgentSchedule[];
  runs: number[];
  onRun: (name: string) => void;
  onOpen: (name: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(agent.name)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(agent.name);
        }
      }}
      className={cn(
        GRID_COLS,
        "cursor-pointer border-b border-border py-3.5 transition-colors hover:bg-muted/40",
        !agent.enabled && "opacity-60",
      )}
    >
      {/* Agent — name + description */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {isDefault && (
            <span
              title="Default agent"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-warm"
            />
          )}
          <span className="font-mono text-sm font-medium">{agent.name}</span>
          {isDefault && (
            <span className="rounded border border-accent-warm/30 px-1.5 py-px text-[10px] font-semibold tracking-[0.08em] text-accent-warm uppercase">
              Default
            </span>
          )}
          {!agent.enabled && (
            <span className="rounded border border-border px-1.5 py-px text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Disabled
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          {agent.description}
        </div>
      </div>

      {/* Next run */}
      <NextRunCell schedules={schedules} />

      {/* Last run */}
      <LastRunCell lastRun={lastRun} />

      {/* 7d sparkline */}
      <Sparkline runs={runs} enabled={agent.enabled} />

      {/* Actions */}
      <div
        className="flex items-center justify-end"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!agent.enabled}
          className="h-7 gap-1 px-2.5 text-xs"
          onClick={() => onRun(agent.name)}
        >
          <Play className="h-3 w-3" />
          Run
        </Button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────

export function AgentsClient({
  agents,
  lastRuns,
  schedules,
  sparklines,
  defaultAgent,
}: Props) {
  const router = useRouter();
  const [runTarget, setRunTarget] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const openRunDialog = useCallback((name: string) => {
    setRunTarget(name);
    setDialogOpen(true);
  }, []);

  const openAgent = useCallback(
    (name: string) => {
      router.push(`/agents/${name}`);
    },
    [router],
  );

  const schedulesByAgent = useMemo(() => {
    const map: Record<string, AgentSchedule[]> = {};
    for (const s of schedules) {
      if (!map[s.agent_name]) map[s.agent_name] = [];
      map[s.agent_name].push(s);
    }
    return map;
  }, [schedules]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents
      .filter((a) => {
        const hasSchedule = (schedulesByAgent[a.name] ?? []).length > 0;
        if (filter === "scheduled" && !(a.enabled && hasSchedule)) return false;
        if (filter === "on-demand" && !(a.enabled && !hasSchedule)) return false;
        if (filter === "disabled" && a.enabled) return false;
        if (!q) return true;
        return (
          a.name.toLowerCase().includes(q) ||
          (a.description || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Default agent first, then enabled, then alphabetical
        if (a.name === defaultAgent) return -1;
        if (b.name === defaultAgent) return 1;
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [agents, query, filter, schedulesByAgent, defaultAgent]);

  const enabledCount = agents.filter((a) => a.enabled).length;
  const emptyRuns = useMemo(() => new Array(7).fill(0), []);

  return (
    <main className="flex h-full flex-col">
      <PageHeader
        total={agents.length}
        enabledCount={enabledCount}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        onNew={() => setNewAgentOpen(true)}
      />

      {agents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-16 text-muted-foreground">
          <Bot className="mb-4 h-12 w-12" />
          <p className="text-xl font-semibold tracking-tight">No agents yet</p>
          <p className="mt-1 text-sm">Create your first agent to get started.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div
            className={cn(
              GRID_COLS,
              "border-b border-border py-2.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase",
            )}
          >
            <div>Agent</div>
            <div>Next run</div>
            <div>Last run</div>
            <div>7d</div>
            <div />
          </div>

          {filteredAgents.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              No agents match.
            </div>
          ) : (
            filteredAgents.map((agent) => (
              <AgentRow
                key={agent.name}
                agent={agent}
                isDefault={agent.name === defaultAgent}
                lastRun={lastRuns[agent.name]}
                schedules={schedulesByAgent[agent.name] ?? []}
                runs={sparklines[agent.name] ?? emptyRuns}
                onRun={openRunDialog}
                onOpen={openAgent}
              />
            ))
          )}
        </div>
      )}

      <RunDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agentName={runTarget}
      />

      <NewAgentModal
        open={newAgentOpen}
        onOpenChange={setNewAgentOpen}
        agents={agents}
      />
    </main>
  );
}
