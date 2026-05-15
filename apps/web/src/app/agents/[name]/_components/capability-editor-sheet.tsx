"use client";

import * as React from "react";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";
import type { Agent } from "../../../types/db";
import { updateAgentAction } from "../../../actions";
import { AVAILABLE_SKILLS, AVAILABLE_TOOL_GROUPS } from "../../constants";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  allOptions,
  currentSelection,
  type CapabilityKind,
} from "./capability-editor-helpers";

export type { CapabilityKind };

const TITLES: Record<CapabilityKind, { title: string; sub: string }> = {
  skills: {
    title: "Skills",
    sub: "Bundles of capability the agent can use",
  },
  tools: {
    title: "Extra tools",
    sub: "Granted on top of what your skills already expose",
  },
  subagents: {
    title: "Subagents",
    sub: "Other agents this one may delegate to",
  },
};

function describe(kind: CapabilityKind, name: string): string | undefined {
  if (kind === "skills") {
    return AVAILABLE_SKILLS.find((s) => s.name === name)?.description;
  }
  if (kind === "tools") {
    for (const g of AVAILABLE_TOOL_GROUPS) {
      if (g.tools.includes(name)) return g.group;
    }
  }
  return undefined;
}

/**
 * Side-sheet editor for a capability (skills, tools, subagents).
 *
 * Uses a command-palette shape: search box at top, checkable list below,
 * footer with Cancel + Save (count). Matches the design&apos;s pattern of
 * &quot;Edit → opens sheet&quot; from the capabilities collapsible rows.
 *
 * The sheet stays open after a successful save so the user can see their
 * saved selection. They close it manually via Cancel or the back-arrow.
 */
export function CapabilityEditorSheet({
  kind,
  agent,
  availableAgents,
  onClose,
}: {
  kind: CapabilityKind | null;
  agent: Agent;
  availableAgents: string[];
  onClose: () => void;
}) {
  return (
    <Sheet
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="max-w-[520px] p-0" hideCloseButton>
        {kind && (
          <EditorBody
            key={kind}
            kind={kind}
            agent={agent}
            availableAgents={availableAgents}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditorBody({
  kind,
  agent,
  availableAgents,
  onClose,
}: {
  kind: CapabilityKind;
  agent: Agent;
  availableAgents: string[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  // `editedSelection` holds the user's in-flight changes once they start toggling.
  // `null` means "no edits yet — use whatever the agent prop says right now", so fresh
  // agent data (e.g. from RSC revalidatePath) is automatically reflected until the
  // user touches a checkbox.
  const [editedSelection, setEditedSelection] = useState<string[] | null>(null);
  const selected = editedSelection ?? currentSelection(kind, agent);

  const config = TITLES[kind];
  const options = useMemo(
    () => allOptions(kind, agent, availableAgents),
    [kind, agent, availableAgents],
  );
  const filtered = useMemo(
    () => options.filter((x) => x.toLowerCase().includes(q.toLowerCase())),
    [options, q],
  );
  const mono = kind === "tools" || kind === "subagents";

  const toggle = (x: string) => {
    setEditedSelection((s) => {
      const base = s ?? currentSelection(kind, agent);
      return base.includes(x) ? base.filter((y) => y !== x) : [...base, x];
    });
  };

  const save = () => {
    const updates: Parameters<typeof updateAgentAction>[1] =
      kind === "skills"
        ? { skills: selected }
        : kind === "tools"
          ? { tools: selected }
          : { subagents: selected };
    startTransition(async () => {
      try {
        await updateAgentAction(agent.name, updates);
        toast.success(`${config.title} updated`);
        // Sheet stays open after save — user closes manually via Cancel/back-arrow.
        // Do NOT call onClose() here: that would close whatever sheet is currently
        // mounted, which may be a different editor opened while this save was in flight.
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Update failed");
      }
    });
  };

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="text-[15px] font-semibold leading-tight">
              Edit {config.title.toLowerCase()}
            </div>
            <div className="text-xs text-muted-foreground">{config.sub}</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : `Save (${selected.length})`}
          </Button>
        </div>
      </header>

      <div className="border-b border-border px-5 py-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-[9px] h-3.5 w-3.5 text-muted-foreground/70" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${config.title.toLowerCase()}…`}
            className="h-8 w-full rounded-sm border border-border bg-background pl-8 pr-3 text-[13px] outline-none focus:border-ring"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nothing matches &quot;{q}&quot;
          </div>
        ) : (
          filtered.map((x) => {
            const on = selected.includes(x);
            const desc = describe(kind, x);
            return (
              <label
                key={x}
                className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-5 py-2 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(x)}
                  className="h-3.5 w-3.5 accent-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[13px]", mono && "font-mono font-medium")}>{x}</div>
                  {desc && <div className="truncate text-xs text-muted-foreground">{desc}</div>}
                </div>
                {on && (
                  <span className="font-mono text-[11.5px] text-muted-foreground/70">selected</span>
                )}
              </label>
            );
          })
        )}
      </div>
    </>
  );
}
