"use client";

import * as React from "react";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Bot, Play, AlertCircle } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatCountdown, humanizeCron, nextRunAt } from "@/lib/cron";
import { NewAgentModal } from "./_components/new-agent-modal";

interface Props {
  agents: Agent[];
  lastRuns: Record<string, TaskRun | null>;
  schedules: EnabledSchedule[];
  defaultAgent: string;
}

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
          <DialogTitle className="font-display text-2xl">
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

// ─── Row (used for default + list) ────────────────────────────────

function statusDot(run: TaskRun | null | undefined) {
  if (!run) return { color: "bg-border", label: "never run" };
  switch (run.status) {
    case "completed":
      return { color: "bg-signal-ok", label: "ok" };
    case "running":
    case "pending":
      return { color: "bg-signal-run signal-dot-run", label: run.status };
    default:
      return { color: "bg-signal-fail", label: "failed" };
  }
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
    return <span className="text-muted-foreground">on demand</span>;
  }

  return (
    <div className="flex flex-col leading-tight">
      <span className="text-foreground">{humanizeCron(next.sched.cron)}</span>
      <span className="text-muted-foreground text-[0.7rem]">
        {formatCountdown(next.at.getTime() - now)}
      </span>
    </div>
  );
}

function AgentRow({
  agent,
  lastRun,
  schedules,
  onRun,
}: {
  agent: Agent;
  lastRun: TaskRun | null | undefined;
  schedules: AgentSchedule[];
  onRun: (name: string) => void;
}) {
  const dot = statusDot(lastRun);
  const model =
    agent.model_provider && agent.model
      ? `${agent.model_provider}:${agent.model}`
      : agent.model || "default";

  return (
    <li className="group rise-in relative border-b border-border">
      <Link
        href={`/agents/${agent.name}`}
        className="flex items-center gap-4 px-6 py-4 pr-28 hover:bg-muted/40 transition-colors"
      >
        {/* Name column */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {!agent.enabled && (
              <span className="section-eyebrow text-muted-foreground">
                disabled
              </span>
            )}
          </div>
          <div className="font-display text-2xl leading-tight tracking-tight text-foreground">
            {agent.name}
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground truncate">
            {agent.description}
          </div>
        </div>

        {/* Model */}
        <div className="hidden md:flex w-40 flex-col text-xs leading-tight">
          <div className="section-eyebrow">model</div>
          <div className="font-mono text-foreground truncate">{model}</div>
        </div>

        {/* Next run */}
        <div className="hidden lg:flex w-48 flex-col text-xs leading-tight">
          <div className="section-eyebrow">next</div>
          <NextRunCell schedules={schedules} />
        </div>

        {/* Last run */}
        <div className="hidden sm:flex w-40 flex-col text-xs leading-tight">
          <div className="section-eyebrow">last run</div>
          <div className="flex items-center gap-1.5 text-foreground">
            <span
              className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot.color)}
              aria-hidden
            />
            <span className="truncate">
              {lastRun?.started_at
                ? formatDistanceToNow(new Date(lastRun.started_at), {
                    addSuffix: true,
                  })
                : "never"}
            </span>
          </div>
          {lastRun?.status === "failed" && lastRun.error && (
            <div className="text-destructive truncate text-[0.7rem] mt-0.5">
              {lastRun.error.slice(0, 40)}
              {lastRun.error.length > 40 ? "…" : ""}
            </div>
          )}
        </div>
      </Link>

      {/* Run button — absolute so it sits over the link without nesting */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRun(agent.name);
          }}
        >
          <Play className="h-3 w-3" />
          Run
        </Button>
      </div>
    </li>
  );
}

// ─── Hero (default agent) ─────────────────────────────────────────

function DefaultHero({
  agent,
  lastRun,
  schedules,
  onRun,
}: {
  agent: Agent;
  lastRun: TaskRun | null | undefined;
  schedules: AgentSchedule[];
  onRun: (name: string) => void;
}) {
  const dot = statusDot(lastRun);
  const model =
    agent.model_provider && agent.model
      ? `${agent.model_provider}:${agent.model}`
      : agent.model || "default";

  return (
    <Link
      href={`/agents/${agent.name}`}
      className="rise-in relative block border-b border-border px-6 py-5 hover:bg-muted/30 transition-colors"
    >
      <div className="section-eyebrow !text-accent-warm">
        ● default agent
      </div>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-4xl leading-none tracking-tight text-foreground">
            {agent.name}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            {agent.description}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRun(agent.name);
          }}
        >
          <Play className="h-3.5 w-3.5" />
          Run now
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-6 text-xs leading-tight">
        <div>
          <div className="section-eyebrow">model</div>
          <div className="font-mono text-foreground truncate">{model}</div>
        </div>
        <div>
          <div className="section-eyebrow">next</div>
          <NextRunCell schedules={schedules} />
        </div>
        <div>
          <div className="section-eyebrow">last run</div>
          <div className="flex items-center gap-1.5 text-foreground">
            <span
              className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot.color)}
              aria-hidden
            />
            <span className="truncate">
              {lastRun?.started_at
                ? formatDistanceToNow(new Date(lastRun.started_at), {
                    addSuffix: true,
                  })
                : "never"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Main ──────────────────────────────────────────────────────────

export function AgentsClient({
  agents,
  lastRuns,
  schedules,
  defaultAgent,
}: Props) {
  const [runTarget, setRunTarget] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);

  const openRunDialog = useCallback((name: string) => {
    setRunTarget(name);
    setDialogOpen(true);
  }, []);

  const schedulesByAgent = useMemo(() => {
    const map: Record<string, AgentSchedule[]> = {};
    for (const s of schedules) {
      if (!map[s.agent_name]) map[s.agent_name] = [];
      map[s.agent_name].push(s);
    }
    return map;
  }, [schedules]);

  const { hero, rest } = useMemo(() => {
    const heroAgent = agents.find((a) => a.name === defaultAgent) ?? null;
    const others = agents.filter((a) => a.name !== heroAgent?.name);
    // Sort: enabled first, then by name
    others.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { hero: heroAgent, rest: others };
  }, [agents, defaultAgent]);

  const anyFailing = agents.some((a) => lastRuns[a.name]?.status === "failed");

  return (
    <main className="flex h-full flex-col">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-6">
        <div>
          <div className="section-eyebrow">Fleet</div>
          <h1 className="font-display text-4xl leading-none tracking-tight">
            Agents
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNewAgentOpen(true)}
        >
          + New agent
        </Button>
      </header>

      {anyFailing && (
        <div className="flex items-center gap-2 border-b border-border bg-destructive/5 px-6 py-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            One or more agents have failing runs. Click a row to see the
            error.
          </span>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-16 text-muted-foreground">
          <Bot className="h-12 w-12 mb-4" />
          <p className="font-display text-xl">No agents yet</p>
          <p className="mt-1 text-sm">Create your first agent to get started.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {hero && (
            <DefaultHero
              agent={hero}
              lastRun={lastRuns[hero.name]}
              schedules={schedulesByAgent[hero.name] ?? []}
              onRun={openRunDialog}
            />
          )}
          <ul>
            {rest.map((agent) => (
              <AgentRow
                key={agent.name}
                agent={agent}
                lastRun={lastRuns[agent.name]}
                schedules={schedulesByAgent[agent.name] ?? []}
                onRun={openRunDialog}
              />
            ))}
          </ul>
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
