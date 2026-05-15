"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import type { Agent } from "../../../types/db";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "./collapsible-section";
import type { CapabilityKind } from "./capability-editor-sheet";

function Chip({
  children,
  variant = "outline",
  mono,
  title,
}: {
  children: React.ReactNode;
  variant?: "outline" | "filled";
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs",
        mono && "font-mono",
        variant === "filled"
          ? "bg-foreground font-medium text-background"
          : "border border-border text-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * "Capabilities" block — three sibling collapsibles: Skills, Tools,
 * Subagents. Each row shows a count badge and a short summary when
 * closed; clicking Edit opens the capability editor sheet.
 *
 * Replaces the chip editing surface previously embedded in Identity.
 */
export function CapabilitiesPanel({
  agent,
  availableAgents,
  onEdit,
  delay = 0,
}: {
  agent: Agent;
  availableAgents: string[];
  onEdit: (kind: CapabilityKind) => void;
  delay?: number;
}) {
  const editBtn = (kind: CapabilityKind) => (
    <button
      type="button"
      onClick={() => onEdit(kind)}
      className="inline-flex items-center gap-1 rounded-sm border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
    >
      Edit
      <ChevronRight className="h-3 w-3" />
    </button>
  );

  const skillsSummary = (
    <span className="truncate font-mono text-[11.5px] text-muted-foreground/70">
      {agent.skills.length === 0
        ? "none"
        : agent.skills.slice(0, 5).join(", ") +
          (agent.skills.length > 5 ? `, +${agent.skills.length - 5}` : "")}
    </span>
  );

  const toolsSummary = (
    <span className="truncate font-mono text-[11.5px] text-muted-foreground/70">
      {agent.tools.length === 0
        ? "none beyond skill tools"
        : agent.tools.slice(0, 3).join(", ") +
          (agent.tools.length > 3 ? `, +${agent.tools.length - 3}` : "")}
    </span>
  );

  const subagentsSummary = (
    <span className="truncate text-xs text-muted-foreground">
      {agent.subagents.length === 0 ? (
        "no delegation"
      ) : (
        <>
          <span className="font-mono">{agent.subagents.slice(0, 3).join(", ")}</span>
          {agent.subagents.length > 3 && ` +${agent.subagents.length - 3}`}
        </>
      )}
    </span>
  );

  return (
    <div className="rise-in" style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <CollapsibleSection
        eyebrow="Skills"
        count={agent.skills.length}
        summary={skillsSummary}
        action={editBtn("skills")}
        delay={0}
      >
        <div className="flex flex-wrap gap-1.5">
          {agent.skills.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">No skills selected.</span>
          ) : (
            agent.skills.map((s) => <Chip key={s}>{s}</Chip>)
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Extra tools"
        count={agent.tools.length}
        summary={toolsSummary}
        action={editBtn("tools")}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Granted on top of what your skills already expose.
        </p>
        <div className="flex flex-wrap gap-1">
          {agent.tools.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">
              None — the agent only uses tools from its selected skills.
            </span>
          ) : (
            agent.tools.map((t) => (
              <Chip key={t} variant="filled" mono>
                {t}
              </Chip>
            ))
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Subagents"
        count={`${agent.subagents.length}${
          availableAgents.length ? `/${availableAgents.length}` : ""
        }`}
        summary={subagentsSummary}
        action={editBtn("subagents")}
      >
        <div className="flex flex-wrap gap-1.5">
          {availableAgents.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">No other agents exist yet.</span>
          ) : (
            availableAgents.map((name) => (
              <Chip
                key={name}
                mono
                variant={agent.subagents.includes(name) ? "filled" : "outline"}
              >
                {name}
              </Chip>
            ))
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
