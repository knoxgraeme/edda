"use client";

import * as React from "react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";

import type { Agent, ThreadLifetime } from "../../types/db";
import { createAgentAction } from "../../actions";

/**
 * Transform free-form user input into a valid agent name slug.
 *
 * Rules (mirror AGENT_NAME_RE = /^[a-z][a-z0-9_]*$/):
 *   - lowercase everything
 *   - spaces and hyphens become underscores
 *   - strip characters outside [a-z0-9_]
 *   - collapse runs of underscores
 *   - strip leading underscores AND leading digits so the slug
 *     always begins with a letter
 *
 * Applied on input change so the user sees their intent become the
 * final slug live. Example: "Research Assistant" → "research_assistant".
 */
function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_0-9]+/, "");
}

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { TemplatePicker, type TemplateSelection } from "./template-picker";

/**
 * Minimal "New agent" dialog.
 *
 * Collects only the three decisions that MUST be made before an agent
 * row can exist: template (shapes skills+config), name, and description.
 * Everything else is edited inline on the detail page (`/agents/{name}`),
 * which is Mission Control — the same UI the user will use for this
 * agent going forward, so there's only one editing pattern to learn.
 *
 * On success, the server action redirects to `/agents/{name}` and the
 * dialog unmounts along with the rest of the page.
 */
export function NewAgentModal({
  open,
  onOpenChange,
  agents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
}) {
  const [pending, startTransition] = useTransition();
  const [templateLabel, setTemplateLabel] = useState<string>("blank");
  const [templateSource, setTemplateSource] = useState<
    TemplateSelection["source"]
  >("blank");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Reset form each time the dialog opens so stale state doesn't bleed
  // between invocations.
  React.useEffect(() => {
    if (open) {
      setTemplateLabel("blank");
      setTemplateSource("blank");
      setName("");
      setDescription("");
    }
  }, [open]);

  const applyTemplate = useCallback((sel: TemplateSelection) => {
    setTemplateLabel(sel.label);
    setTemplateSource(sel.source);
  }, []);

  // Name is normalized at input time, so it can't land in an invalid
  // state — the only failure mode is "empty".
  const canSubmit = name.length > 0 && description.length > 0 && !pending;

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSubmit) return;
      startTransition(async () => {
        try {
          const src = templateSource;
          const base: Parameters<typeof createAgentAction>[0] = {
            name,
            description,
          };
          if (src !== "blank") {
            base.skills = src.skills;
            base.thread_lifetime = src.thread_lifetime as ThreadLifetime;
            base.trigger = src.trigger ?? undefined;
            base.model_provider = src.model_provider ?? null;
            base.model = src.model ?? null;
            base.system_prompt = src.system_prompt ?? undefined;
            base.subagents = src.subagents;
            base.tools = src.tools;
          }
          await createAgentAction(base);
          // createAgentAction redirects on success; we never reach here
          // in the happy path.
        } catch (err) {
          if (err && typeof err === "object" && "digest" in err) throw err;
          toast.error(
            err instanceof Error ? err.message : "Failed to create agent",
          );
        }
      });
    },
    [canSubmit, templateSource, name, description],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              New agent
            </DialogTitle>
            <DialogDescription>
              Name and describe the agent. Pick a starting template. Everything
              else — skills, schedules, channels, prompt — is edited inline on
              the agent page after you create it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-3">
            <div className="grid gap-2">
              <div className="section-eyebrow">Template</div>
              <TemplatePicker
                agents={agents}
                selected={templateLabel}
                onSelect={applyTemplate}
              />
              {templateSource !== "blank" && (
                <p className="text-xs text-muted-foreground">
                  Inherits {templateSource.skills.length} skill
                  {templateSource.skills.length === 1 ? "" : "s"},{" "}
                  {templateSource.thread_lifetime} threading,{" "}
                  {templateSource.trigger ?? "on_demand"} trigger.
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="new-agent-name">Name</Label>
              <Input
                id="new-agent-name"
                value={name}
                onChange={(e) => setName(normalizeName(e.target.value))}
                placeholder="e.g., Research Assistant"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Type anything — we&apos;ll convert it to a lowercase slug.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="new-agent-description">Description</Label>
              <Input
                id="new-agent-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? "Creating…" : "Create agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
