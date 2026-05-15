"use client";

import * as React from "react";
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Trash2, History } from "lucide-react";
import { toast } from "sonner";

import type { Agent, AgentChannel, AgentSchedule, TaskRun } from "../../types/db";
import { deleteAgentAction, toggleAgentAction } from "../../actions";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { ChatProvider, useChatContext } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { ThreadList } from "@/app/components/ThreadList";

import { IdentityPanel } from "./_components/identity-panel";
import { SchedulesPanel } from "./_components/schedules-panel";
import { CapabilitiesPanel } from "./_components/capabilities-panel";
import { ChannelStrip } from "./_components/channel-strip";
import { ConfigHeader } from "./_components/config-header";
import { PromptSheet } from "./_components/prompt-sheet";
import { CapabilityEditorSheet, type CapabilityKind } from "./_components/capability-editor-sheet";
import { RunsPanel } from "./_components/runs-panel";

function RunNowDialog({
  open,
  onOpenChange,
  agentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentName)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          notify: ["inbox"],
        }),
      });
      if (res.ok) {
        toast.success(`${agentName} triggered`);
        onOpenChange(false);
        setPrompt("");
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
            Runs the agent with an ephemeral thread. Result is delivered to the inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label htmlFor="run-prompt" className="sr-only">
            Prompt
          </Label>
          <textarea
            id="run-prompt"
            className="min-h-[120px] w-full rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="What should the agent do?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !prompt.trim()} className="gap-1">
            <Play className="h-3.5 w-3.5" />
            {submitting ? "Running…" : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Chat pane (left) with Test/Runs tabs ──────────────────────────

function TabButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-[11px] inline-flex items-center gap-1.5 border-b-2 px-2 pb-[10px] pt-1 font-mono text-[11px] font-medium uppercase tracking-[0.12em]",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && <span className="text-[10px] text-muted-foreground/70">{count}</span>}
    </button>
  );
}

function ChatPaneInner({
  agentName,
  threadLifetime,
  initialRuns,
  onRunNow,
}: {
  agentName: string;
  threadLifetime: Agent["thread_lifetime"];
  initialRuns: TaskRun[];
  onRunNow: () => void;
}) {
  const [tab, setTab] = useState<"test" | "runs">("test");
  const [showThreads, setShowThreads] = useState(false);
  // Polling lives here so the Runs tab badge count stays live even while
  // the user is on the Test tab. RunsPanel receives runs as a prop.
  const [runs, setRuns] = useState<TaskRun[]>(initialRuns);
  const { threadId, loadThread } = useChatContext();
  const showThreadSidebar = threadLifetime === "daily";

  const handleThreadSelect = useCallback(
    (id: string) => {
      void loadThread(id);
      setShowThreads(false);
    },
    [loadThread],
  );

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentName)}/runs?limit=20`);
        if (!res.ok) return;
        const data = await res.json();
        setRuns(Array.isArray(data) ? data : data.data);
      } catch {
        /* silent */
      }
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchRuns();
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchRuns();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [agentName]);

  return (
    <div className="flex h-full min-h-0">
      {showThreadSidebar && showThreads && tab === "test" && (
        <div className="relative w-64 flex-shrink-0 border-r border-border bg-muted/30">
          <ThreadList
            agentName={agentName}
            currentThreadId={threadId ?? undefined}
            onThreadSelect={handleThreadSelect}
            onClose={() => setShowThreads(false)}
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-[9px]">
          <div className="flex items-center gap-1">
            <TabButton active={tab === "test"} onClick={() => setTab("test")}>
              Test agent
            </TabButton>
            <TabButton active={tab === "runs"} onClick={() => setTab("runs")} count={runs.length}>
              Runs
            </TabButton>
          </div>
          {tab === "test" && (
            <div className="flex items-center gap-1">
              <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-ok" />
                connected
              </span>
              <span className="mr-0.5 font-mono text-[11.5px] text-muted-foreground/70">
                thread: {threadLifetime}
              </span>
              {showThreadSidebar && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowThreads((v) => !v)}
                  aria-label="History"
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
        {tab === "test" ? (
          <ChatInterface hideWelcome />
        ) : (
          <RunsPanel runs={runs} onRunNow={onRunNow} />
        )}
      </div>
    </div>
  );
}

function ChatPane({
  agentName,
  threadLifetime,
  initialRuns,
  onRunNow,
}: {
  agentName: string;
  threadLifetime: Agent["thread_lifetime"];
  initialRuns: TaskRun[];
  onRunNow: () => void;
}) {
  return (
    <ChatProvider agentName={agentName}>
      <ChatPaneInner
        agentName={agentName}
        threadLifetime={threadLifetime}
        initialRuns={initialRuns}
        onRunNow={onRunNow}
      />
    </ChatProvider>
  );
}

// ─── Main ──────────────────────────────────────────────────────────

export function AgentDetailClient({
  agent,
  runs,
  schedules,
  channels,
  availableAgents,
}: {
  agent: Agent;
  runs: TaskRun[];
  schedules: AgentSchedule[];
  channels: AgentChannel[];
  availableAgents: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(agent.enabled);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [editorKind, setEditorKind] = useState<CapabilityKind | null>(null);

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    startTransition(async () => {
      try {
        await toggleAgentAction(agent.name, next);
      } catch (err) {
        setEnabled(!next);
        toast.error(err instanceof Error ? err.message : "Failed to toggle agent");
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteAgentAction(agent.name);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        toast.error(err instanceof Error ? err.message : "Failed to delete agent");
      }
    });
  };

  const modelLabel =
    agent.model_provider && agent.model
      ? `${agent.model_provider}:${agent.model}`
      : agent.model || "default";

  return (
    <main className="flex h-full flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Link href="/agents">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-[17px] font-semibold leading-none tracking-tight">
            {agent.name}
          </h1>
          <div className="mt-1.5 flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
            <span>{modelLabel}</span>
            <span aria-hidden>·</span>
            <span>{agent.thread_lifetime}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setRunDialogOpen(true)}
        >
          <Play className="h-3.5 w-3.5" />
          Run now
        </Button>
        <div className="h-5 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
          aria-label="Delete agent"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-2 border-l border-border pl-2">
          <Label htmlFor="agent-enabled" className="text-xs text-muted-foreground">
            {enabled ? "enabled" : "disabled"}
          </Label>
          <Switch
            id="agent-enabled"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={pending}
          />
        </div>
      </header>

      {/* ── Split body: chat left, config right ─────────────────── */}
      <ResizablePanelGroup
        id="agent-detail-split"
        direction="horizontal"
        className="min-h-0 flex-1"
      >
        <ResizablePanel defaultSize={42} minSize={28}>
          <ChatPane
            agentName={agent.name}
            threadLifetime={agent.thread_lifetime}
            initialRuns={runs}
            onRunNow={() => setRunDialogOpen(true)}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={58} minSize={36}>
          <div className="flex h-full flex-col">
            <ConfigHeader />
            <ChannelStrip agentName={agent.name} channels={channels} />
            <div className="flex-1 overflow-y-auto">
              <IdentityPanel agent={agent} onOpenPrompt={() => setPromptOpen(true)} delay={0} />
              <SchedulesPanel
                agentName={agent.name}
                schedules={schedules}
                availableAgents={availableAgents}
                delay={60}
              />
              <CapabilitiesPanel
                agent={agent}
                availableAgents={availableAgents}
                onEdit={(k) => setEditorKind(k)}
                delay={120}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <RunNowDialog open={runDialogOpen} onOpenChange={setRunDialogOpen} agentName={agent.name} />

      <PromptSheet agent={agent} open={promptOpen} onOpenChange={setPromptOpen} />

      <CapabilityEditorSheet
        kind={editorKind}
        agent={agent}
        availableAgents={availableAgents}
        onClose={() => setEditorKind(null)}
      />
    </main>
  );
}
