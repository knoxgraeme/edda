"use client";

import * as React from "react";
import { useTransition } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { toast } from "sonner";
import type { Agent, LlmProvider, ThreadLifetime } from "../../../types/db";
import { updateAgentAction } from "../../../actions";
import { LLM_PROVIDER_OPTIONS, VALID_LLM_PROVIDERS } from "@/lib/providers";
import { InlineText } from "./inline-edit";
import { Select } from "@/components/ui/select";
import { CollapsibleSection, SummaryPill, SummaryText } from "./collapsible-section";

function toProvider(value: string): LlmProvider | null {
  if (!value) return null;
  if (VALID_LLM_PROVIDERS.has(value as LlmProvider)) return value as LlmProvider;
  return null;
}

/**
 * Identity — description, thread lifetime, model, and an Instructions
 * row that opens the system-prompt / AGENTS.md sheet.
 *
 * Skills, tools, and subagents moved to the Capabilities panel below.
 */
export function IdentityPanel({
  agent,
  onOpenPrompt,
  delay = 0,
}: {
  agent: Agent;
  onOpenPrompt: () => void;
  delay?: number;
}) {
  const [pending, startTransition] = useTransition();

  const save = React.useCallback(
    async (updates: Parameters<typeof updateAgentAction>[1], successMsg = "Saved") => {
      return new Promise<void>((resolve, reject) => {
        startTransition(async () => {
          try {
            await updateAgentAction(agent.name, updates);
            toast.success(successMsg);
            resolve();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed");
            reject(err);
          }
        });
      });
    },
    [agent.name],
  );

  const modelLabel =
    agent.model_provider && agent.model ? `${agent.model_provider}:${agent.model}` : "Default";

  const summary = (
    <>
      <SummaryPill>{agent.thread_lifetime}</SummaryPill>
      <SummaryPill>{modelLabel.toLowerCase()}</SummaryPill>
      <SummaryText status={agent.system_prompt ? "ok" : "muted"}>
        {agent.system_prompt ? "custom prompt" : "no custom prompt"}
      </SummaryText>
    </>
  );

  return (
    <CollapsibleSection eyebrow="Identity" defaultOpen summary={summary} delay={delay}>
      <div className="divide-y divide-border/60">
        <IdRow label="Description">
          <InlineText
            value={agent.description}
            placeholder="Describe what this agent does"
            ariaLabel="Description"
            onSave={(next) => save({ description: next }, "Description updated")}
          />
        </IdRow>

        <IdRow label="Thread">
          <div className="flex items-center gap-2">
            <Select
              value={agent.thread_lifetime}
              onChange={(e) =>
                save(
                  { thread_lifetime: e.target.value as ThreadLifetime },
                  "Thread lifetime updated",
                )
              }
              disabled={pending}
              className="h-7 w-32 text-xs"
            >
              <option value="ephemeral">Ephemeral</option>
              <option value="daily">Daily</option>
              <option value="persistent">Persistent</option>
            </Select>
            <span className="font-mono text-[11.5px] text-muted-foreground/70">
              scope: {agent.thread_scope}
            </span>
          </div>
        </IdRow>

        <IdRow label="Model">
          <div className="flex items-center gap-2">
            <Select
              value={agent.model_provider ?? ""}
              onChange={(e) =>
                save({ model_provider: toProvider(e.target.value) }, "Provider updated")
              }
              disabled={pending}
              className="h-7 w-36 text-xs"
            >
              <option value="">Default</option>
              {LLM_PROVIDER_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
            <InlineText
              value={agent.model ?? ""}
              placeholder="click to override default"
              mono
              ariaLabel="Model"
              className="min-w-0 flex-1"
              onSave={(next) => save({ model: next || null }, "Model updated")}
            />
          </div>
        </IdRow>

        <IdRow
          label="Instructions"
          trailing={
            <span className="font-mono text-[11.5px] text-muted-foreground/70">
              {(agent.system_prompt ?? "").length.toLocaleString()} chars
            </span>
          }
        >
          <button
            type="button"
            onClick={onOpenPrompt}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[12.5px] text-foreground/80 hover:bg-muted hover:text-foreground"
          >
            <FileText className="h-3 w-3" />
            <span>System prompt</span>
            <span className="text-muted-foreground/50">·</span>
            <span>AGENTS.md</span>
            <ArrowUpRight className="h-3 w-3 text-muted-foreground/70" />
          </button>
        </IdRow>
      </div>
    </CollapsibleSection>
  );
}

function IdRow({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-center gap-3 py-2 text-sm">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
      <div className="justify-self-end">{trailing}</div>
    </div>
  );
}
