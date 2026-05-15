"use client";

import * as React from "react";
import type { Agent } from "../../types/db";
import { cn } from "@/lib/utils";

export interface TemplateSelection {
  label: string;
  source: "blank" | Agent;
}

/**
 * Template row shown at the top of the New Agent modal.
 *
 * Options:
 *   - blank: start with all defaults
 *   - <existing agent>: prefill skills, thread_lifetime, trigger,
 *     model, subagents, and system_prompt from that agent
 *
 * Picking a template does NOT copy the name or description — those
 * stay empty so the user types new ones.
 */
export function TemplatePicker({
  agents,
  selected,
  onSelect,
}: {
  agents: Agent[];
  selected: string;
  onSelect: (selection: TemplateSelection) => void;
}) {
  // Filter out disabled agents from the template list — no point
  // cloning broken state.
  const templatable = agents.filter((a) => a.enabled);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="section-eyebrow">start from</span>
      <button
        type="button"
        onClick={() => onSelect({ label: "blank", source: "blank" })}
        className={cn(
          "rounded-sm border px-2.5 py-1 text-xs transition-colors",
          selected === "blank"
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground",
        )}
      >
        blank
      </button>
      {templatable.map((agent) => (
        <button
          key={agent.name}
          type="button"
          onClick={() => onSelect({ label: agent.name, source: agent })}
          className={cn(
            "rounded-sm border px-2.5 py-1 text-xs transition-colors",
            selected === agent.name
              ? "border-foreground bg-foreground text-background"
              : "border-muted-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground",
          )}
          title={agent.description}
        >
          {agent.name}
        </button>
      ))}
    </div>
  );
}
