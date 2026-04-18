"use client";

import * as React from "react";
import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Trash2, History } from "lucide-react";
import { toast } from "sonner";

import type {
  Agent,
  AgentChannel,
  AgentSchedule,
  TaskRun,
} from "../../types/db";
import { deleteAgentAction, toggleAgentAction } from "../../actions";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { ChatProvider, useChatContext } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { ThreadList } from "@/app/components/ThreadList";

import { IdentityPanel } from "./_components/identity-panel";
import { SchedulesPanel } from "./_components/schedules-panel";
import { ChannelsPanel } from "./_components/channels-panel";
import { RunsPanel } from "./_components/runs-panel";
import { PromptPanel } from "./_components/prompt-panel";

// ─── Run-now dialog ────────────────────────────────────────────────
//
// Kept in this file because it's a narrow header affordance and the
// previous monolith's separate RunNowDialog was unused by the list
// page (which bypassed it with a broken quick-run). This replaces both.

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
            Runs the agent with an ephemeral thread. Result is delivered to the
            inbox.
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

// ─── Chat pane (left) ──────────────────────────────────────────────

function ChatPaneInner({
  agentName,
  threadLifetime,
}: {
  agentName: string;
  threadLifetime: Agent["thread_lifetime"];
}) {
  const [showThreads, setShowThreads] = useState(false);
  const { threadId, loadThread } = useChatContext();
  const showThreadSidebar = threadLifetime === "daily";

  const handleThreadSelect = useCallback(
    (id: string) => {
      void loadThread(id);
      setShowThreads(false);
    },
    [loadThread],
  );

  return (
    <div className="flex h-full min-h-0">
      {showThreadSidebar && showThreads && (
        <div className="relative w-64 flex-shrink-0 border-r border-border bg-muted/30">
          <ThreadList
            agentName={agentName}
            currentThreadId={threadId ?? undefined}
            onThreadSelect={handleThreadSelect}
            onClose={() => setShowThreads(false)}
          />
        </div>
      )}
      <div className="flex flex-1 min-h-0 flex-col">
        {showThreadSidebar && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowThreads((v) => !v)}
              className="h-7 gap-1.5 px-2"
            >
              <History className="h-3.5 w-3.5" />
              <span className="text-xs">History</span>
            </Button>
          </div>
        )}
        <ChatInterface hideWelcome />
      </div>
    </div>
  );
}

function ChatPane({
  agentName,
  threadLifetime,
}: {
  agentName: string;
  threadLifetime: Agent["thread_lifetime"];
}) {
  return (
    <ChatProvider agentName={agentName}>
      <ChatPaneInner agentName={agentName} threadLifetime={threadLifetime} />
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

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    startTransition(async () => {
      try {
        await toggleAgentAction(agent.name, next);
      } catch (err) {
        setEnabled(!next);
        toast.error(
          err instanceof Error ? err.message : "Failed to toggle agent",
        );
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`))
      return;
    startTransition(async () => {
      try {
        await deleteAgentAction(agent.name);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        toast.error(
          err instanceof Error ? err.message : "Failed to delete agent",
        );
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
          <h1 className="text-3xl font-bold leading-none tracking-tight">
            {agent.name}
          </h1>
          <div className="mt-1.5 flex items-center gap-2 text-[0.7rem] font-mono text-muted-foreground">
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
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
          aria-label="Delete agent"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-2 pl-2 border-l border-border">
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

      {/* ── Split body: chat left, sectioned settings right ──── */}
      {/* Explicit stable id avoids react-resizable-panels' useId() SSR
          mismatch when ancestor tree shape differs between server/client
          (ChatProvider hydration, etc). */}
      <ResizablePanelGroup
        id="agent-detail-split"
        direction="horizontal"
        className="flex-1 min-h-0"
      >
        <ResizablePanel defaultSize={42} minSize={28}>
          <ChatPane
            agentName={agent.name}
            threadLifetime={agent.thread_lifetime}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={58} minSize={36}>
          <div className="h-full overflow-y-auto">
            <IdentityPanel
              agent={agent}
              availableAgents={availableAgents}
              delay={0}
            />
            <SchedulesPanel
              agentName={agent.name}
              schedules={schedules}
              availableAgents={availableAgents}
              delay={60}
            />
            <ChannelsPanel
              agentName={agent.name}
              channels={channels}
              delay={120}
            />
            <RunsPanel agentName={agent.name} runs={runs} delay={180} />
            <PromptPanel agent={agent} delay={240} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <RunNowDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        agentName={agent.name}
      />
    </main>
  );
}
