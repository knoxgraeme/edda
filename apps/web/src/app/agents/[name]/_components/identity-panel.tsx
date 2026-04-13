"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import type { Agent, AgentTrigger, LlmProvider, ThreadLifetime } from "../../../types/db";
import { updateAgentAction } from "../../../actions";
import { AVAILABLE_SKILLS } from "../../constants";
import { LLM_PROVIDER_OPTIONS, VALID_LLM_PROVIDERS } from "@/lib/providers";
import { Section, DataRow } from "./section";
import { InlineText } from "./inline-edit";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function toProvider(value: string): LlmProvider | null {
  if (!value) return null;
  if (VALID_LLM_PROVIDERS.has(value as LlmProvider)) return value as LlmProvider;
  return null;
}

/**
 * Identity section — name, description, model, skills, subagents.
 * All fields click-to-edit in place.
 */
export function IdentityPanel({
  agent,
  availableAgents,
  delay = 0,
}: {
  agent: Agent;
  availableAgents: string[];
  delay?: number;
}) {
  const [pending, startTransition] = useTransition();

  const save = React.useCallback(
    async (
      updates: Parameters<typeof updateAgentAction>[1],
      successMsg = "Saved",
    ) => {
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

  const skillSet = new Set(agent.skills);

  const toggleSkill = (skillName: string) => {
    if (pending) return;
    const next = new Set(skillSet);
    if (next.has(skillName)) next.delete(skillName);
    else next.add(skillName);
    void save({ skills: Array.from(next) }, "Skills updated");
  };

  const toggleSubagent = (subagentName: string) => {
    if (pending) return;
    const next = new Set(agent.subagents);
    if (next.has(subagentName)) next.delete(subagentName);
    else next.add(subagentName);
    void save({ subagents: Array.from(next) }, "Subagents updated");
  };

  return (
    <Section eyebrow="Identity" delay={delay}>
      <div className="space-y-1">
        <DataRow label="Description">
          <InlineText
            value={agent.description}
            placeholder="Describe what this agent does"
            ariaLabel="Description"
            onSave={(next) => save({ description: next }, "Description updated")}
          />
        </DataRow>

        <DataRow label="Thread">
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
              className="h-7 text-xs w-32"
            >
              <option value="ephemeral">Ephemeral</option>
              <option value="daily">Daily</option>
              <option value="persistent">Persistent</option>
            </Select>
            <span className="text-xs text-muted-foreground">
              scope: {agent.thread_scope}
            </span>
          </div>
        </DataRow>

        <DataRow label="Trigger">
          <Select
            value={agent.trigger ?? "on_demand"}
            onChange={(e) =>
              save(
                { trigger: e.target.value as AgentTrigger },
                "Trigger updated",
              )
            }
            disabled={pending}
            className="h-7 text-xs w-36"
          >
            <option value="on_demand">On demand</option>
            <option value="schedule">Schedule · cron</option>
          </Select>
        </DataRow>

        <DataRow label="Model">
          <div className="flex items-center gap-2">
            <Select
              value={agent.model_provider ?? ""}
              onChange={(e) =>
                save(
                  { model_provider: toProvider(e.target.value) },
                  "Provider updated",
                )
              }
              disabled={pending}
              className="h-7 text-xs w-36"
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
              className="flex-1 min-w-0"
              onSave={(next) =>
                save({ model: next || null }, "Model updated")
              }
            />
          </div>
        </DataRow>
      </div>

      <div className="mt-4">
        <div className="section-eyebrow mb-2">Skills</div>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABLE_SKILLS.map((s) => {
            const active = skillSet.has(s.name);
            return (
              <button
                key={s.name}
                type="button"
                disabled={pending}
                onClick={() => toggleSkill(s.name)}
                title={s.description}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs transition-colors border",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-muted-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground",
                )}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      </div>

      {agent.tools.length > 0 && (
        <div className="mt-4">
          <div className="section-eyebrow mb-2">Tools</div>
          <div className="flex flex-wrap gap-1">
            {agent.tools.map((t) => (
              <Badge key={t} variant="outline" className="text-xs font-mono">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {availableAgents.length > 0 && (
        <div className="mt-4">
          <div className="section-eyebrow mb-2">Subagents</div>
          <div className="flex flex-wrap gap-1.5">
            {availableAgents.map((name) => {
              const active = agent.subagents.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={pending}
                  onClick={() => toggleSubagent(name)}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs transition-colors border",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}
