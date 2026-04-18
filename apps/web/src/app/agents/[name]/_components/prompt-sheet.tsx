"use client";

import * as React from "react";
import { useEffect, useRef, useState, useTransition } from "react";

import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import type { Agent } from "../../../types/db";
import { updateAgentAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Tab = "prompt" | "agents_md";

/**
 * Right-side drawer for editing the agent&apos;s system prompt and AGENTS.md.
 *
 * Replaces the old inline PromptPanel — surfaced via the &quot;Instructions&quot;
 * row in Identity. Uses our Sheet primitive (Radix Dialog based).
 */
export function PromptSheet({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dirtyRef = useRef(false);

  const handleInterceptClose = (e: { preventDefault: () => void }) => {
    if (dirtyRef.current) {
      e.preventDefault();
      if (window.confirm("Discard unsaved changes?")) {
        onOpenChange(false);
      }
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="max-w-[900px] sm:max-w-[70vw] p-0 [&>button[data-slot=dialog-close]]:hidden"
        onEscapeKeyDown={handleInterceptClose}
        onInteractOutside={handleInterceptClose}
      >
        {open && (
          <PromptSheetBody
            agent={agent}
            onClose={() => onOpenChange(false)}
            onDirtyChange={(d) => {
              dirtyRef.current = d;
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Stateful body; mounted only while the sheet is open, so draft state
 * resets naturally on close.
 */
function PromptSheetBody({
  agent,
  onClose,
  onDirtyChange,
}: {
  agent: Agent;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("prompt");
  const [promptDraft, setPromptDraft] = useState(agent.system_prompt ?? "");

  const dirty = promptDraft !== (agent.system_prompt ?? "");

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const confirmClose = (closeFn: () => void) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    closeFn();
  };

  const savePrompt = () => {
    startTransition(async () => {
      try {
        await updateAgentAction(agent.name, {
          system_prompt: promptDraft || null,
        });
        toast.success("System prompt saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save prompt");
      }
    });
  };

  const discard = () => setPromptDraft(agent.system_prompt ?? "");

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => confirmClose(onClose)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="text-[15px] font-semibold leading-tight">
              {tab === "prompt" ? "System prompt" : "AGENTS.md"}
            </div>
            <div className="text-xs text-muted-foreground">
              {agent.name} · {agent.thread_lifetime}
            </div>
          </div>
        </div>
        {tab === "prompt" && (
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-muted-foreground/70">
              {promptDraft.length.toLocaleString()} chars
            </span>
            <Button variant="outline" size="sm" onClick={discard} disabled={!dirty || pending}>
              Discard
            </Button>
            <Button size="sm" onClick={savePrompt} disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </header>

      <div className="flex items-center gap-1 border-b border-border px-6 py-2.5">
        <TabBtn current={tab} value="prompt" onClick={setTab}>
          System prompt
        </TabBtn>
        <TabBtn current={tab} value="agents_md" onClick={setTab}>
          AGENTS.md
        </TabBtn>
      </div>

      {tab === "prompt" ? (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder="No custom system prompt. Write instructions that define this agent's behavior, voice, and guardrails."
            className="h-full min-h-[420px] w-full resize-none rounded-md border border-border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <AgentsMdPane />
      )}

      <SheetFooter className="justify-between">
        <div className="text-xs text-muted-foreground">
          Instructions shape this agent&apos;s behavior.
        </div>
        <Button variant="outline" size="sm" onClick={() => confirmClose(onClose)}>
          Close
        </Button>
      </SheetFooter>
    </>
  );
}

function TabBtn({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "rounded-sm border border-transparent px-2.5 py-1 text-[12.5px]",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function AgentsMdPane() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-sm leading-relaxed text-muted-foreground">
        <div className="mb-2 font-medium text-foreground">AGENTS.md is agent-owned.</div>
        This file is the agent&apos;s operating notes — how to serve you, what patterns to follow,
        past corrections. It&apos;s written and updated by the agent itself during self-reflection,
        not edited by hand here.
      </div>
    </div>
  );
}
