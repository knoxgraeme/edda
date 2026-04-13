"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Agent } from "../../../types/db";
import { updateAgentAction } from "../../../actions";
import { Section } from "@/app/components/section";
import { Button } from "@/components/ui/button";

/**
 * Expanding system prompt editor.
 * Collapsed by default; click the header to reveal the editor.
 */
export function PromptPanel({
  agent,
  delay = 0,
}: {
  agent: Agent;
  delay?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(agent.system_prompt ?? "");
  const dirty = draft !== (agent.system_prompt ?? "");

  const save = () => {
    startTransition(async () => {
      try {
        await updateAgentAction(agent.name, {
          system_prompt: draft || null,
        });
        toast.success("System prompt saved");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save prompt",
        );
      }
    });
  };

  return (
    <Section
      eyebrow="System prompt"
      delay={delay}
      action={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {open ? "collapse" : "expand"}
        </button>
      }
    >
      {!open ? (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {agent.system_prompt || (
            <span className="italic">No custom system prompt.</span>
          )}
        </p>
      ) : (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            placeholder="Describe this agent's task, output format, and boundaries."
            className="w-full rounded-sm border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(agent.system_prompt ?? "")}
                disabled={pending}
              >
                Revert
              </Button>
            )}
            <Button
              size="sm"
              onClick={save}
              disabled={!dirty || pending}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
