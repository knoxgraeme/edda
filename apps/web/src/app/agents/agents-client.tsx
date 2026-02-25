"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import type { Agent, TaskRun } from "../types/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  agents: Agent[];
  lastRuns: Record<string, TaskRun | null>;
}

export function AgentsClient({ agents, lastRuns }: Props) {
  const [triggeringAgent, setTriggeringAgent] = useState<string | null>(null);

  const triggerRun = useCallback(
    async (name: string) => {
      if (triggeringAgent) return;
      setTriggeringAgent(name);
      try {
        const res = await fetch(`/api/v1/agents/${encodeURIComponent(name)}/run`, {
          method: "POST",
        });
        if (res.ok) toast.success(`${name} triggered`);
        else toast.error(`Failed to trigger ${name}`);
      } finally {
        setTriggeringAgent(null);
      }
    },
    [triggeringAgent],
  );

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Agents</h1>
        <Link href="/agents/new">
          <Button variant="outline" size="sm">
            New Agent
          </Button>
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Bot className="h-12 w-12 mb-4" />
          <p className="text-lg font-medium">No agents yet</p>
          <p className="text-sm">Create your first agent to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => {
            const lastRun = lastRuns[agent.name];
            return (
              <Link key={agent.name} href={`/agents/${agent.name}`}>
                <Card className="p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{agent.name}</span>
                        {!agent.enabled && <Badge variant="destructive">disabled</Badge>}
                        {agent.trigger && <Badge variant="secondary">{agent.trigger}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{agent.description}</p>
                      {agent.schedule && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Schedule: {agent.schedule}
                        </p>
                      )}
                      {agent.skills.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {agent.skills.map((s) => (
                            <Badge key={s} variant="outline" className="text-xs">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {lastRun && (
                        <Badge
                          variant={lastRun.status === "completed" ? "default" : "destructive"}
                        >
                          {lastRun.status}
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={triggeringAgent === agent.name}
                        onClick={(e) => {
                          e.preventDefault();
                          triggerRun(agent.name);
                        }}
                      >
                        {triggeringAgent === agent.name ? "Triggering..." : "Run Now"}
                      </Button>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
