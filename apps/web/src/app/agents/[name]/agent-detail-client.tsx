"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, Play, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Agent, TaskRun } from "../../types/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toggleAgentAction, deleteAgentAction } from "../../actions";

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  switch (status) {
    case "completed":
      return "default";
    case "running":
    case "pending":
      return "secondary";
    default:
      return "destructive";
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentDetailClient({ agent, runs: initialRuns }: { agent: Agent; runs: TaskRun[] }) {
  const [isPending, startTransition] = useTransition();
  const [runs, setRuns] = useState(initialRuns);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Poll for run updates every 30s
  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/agents/${agent.name}/runs?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.data ?? data);
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [agent.name]);

  useEffect(() => {
    const interval = setInterval(fetchRuns, 30_000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const triggerRun = async () => {
    const res = await fetch(`/api/v1/agents/${agent.name}/run`, { method: "POST" });
    if (res.ok) {
      toast.success(`${agent.name} triggered`);
      // Refresh runs after a short delay
      setTimeout(fetchRuns, 2000);
    } else {
      toast.error(`Failed to trigger ${agent.name}`);
    }
  };

  const handleToggle = (enabled: boolean) => {
    startTransition(async () => {
      try {
        await toggleAgentAction(agent.name, enabled);
        toast.success(enabled ? "Agent enabled" : "Agent disabled");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to toggle agent");
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteAgentAction(agent.name);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete agent");
      }
    });
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/agents">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold flex-1">{agent.name}</h1>
        <div className="flex items-center gap-2">
          <Label htmlFor="agent-enabled" className="text-sm text-muted-foreground">
            {agent.enabled ? "Enabled" : "Disabled"}
          </Label>
          <Switch
            id="agent-enabled"
            checked={agent.enabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Agent Info */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Configuration</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={triggerRun}>
                <Play className="h-3.5 w-3.5" />
                Run Now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">{agent.description}</p>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Context mode:</span>{" "}
              <Badge variant="outline">{agent.context_mode}</Badge>
            </div>
            {agent.trigger && (
              <div>
                <span className="text-muted-foreground">Trigger:</span>{" "}
                <Badge variant="outline">{agent.trigger}</Badge>
              </div>
            )}
            {agent.schedule && (
              <div>
                <span className="text-muted-foreground">Schedule:</span>{" "}
                <code className="text-xs">{agent.schedule}</code>
              </div>
            )}
            {agent.model_settings_key && (
              <div>
                <span className="text-muted-foreground">Model:</span>{" "}
                <code className="text-xs">{agent.model_settings_key}</code>
              </div>
            )}
          </div>

          {agent.skills.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Skills:</span>
              <div className="flex gap-1 mt-1 flex-wrap">
                {agent.skills.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {agent.tools.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Tools:</span>
              <div className="flex gap-1 mt-1 flex-wrap">
                {agent.tools.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {agent.subagents.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Subagents:</span>
              <div className="flex gap-1 mt-1 flex-wrap">
                {agent.subagents.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {agent.system_prompt && (
            <>
              <Separator />
              <button
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setShowPrompt(!showPrompt)}
              >
                {showPrompt ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                System prompt
              </button>
              {showPrompt && (
                <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-64">
                  {agent.system_prompt}
                </pre>
              )}
            </>
          )}

          {Object.keys(agent.metadata).length > 0 && (
            <>
              <Separator />
              <button
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setShowMetadata(!showMetadata)}
              >
                {showMetadata ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Metadata
              </button>
              {showMetadata && (
                <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-64">
                  {JSON.stringify(agent.metadata, null, 2)}
                </pre>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run History</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <div key={run.id}>
                  <button
                    className="w-full text-left p-3 rounded-md hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {run.trigger}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatDuration(run.duration_ms)}</span>
                        {run.started_at && (
                          <span>
                            {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                    {run.output_summary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {run.output_summary}
                      </p>
                    )}
                  </button>
                  {expandedRun === run.id && (
                    <div className="ml-3 p-3 bg-muted/30 rounded-md text-xs space-y-2">
                      {run.output_summary && (
                        <div>
                          <span className="text-muted-foreground">Output:</span>
                          <p className="whitespace-pre-wrap mt-1">{run.output_summary}</p>
                        </div>
                      )}
                      {run.error && (
                        <div>
                          <span className="text-destructive">Error:</span>
                          <p className="whitespace-pre-wrap mt-1 text-destructive">{run.error}</p>
                        </div>
                      )}
                      {run.model && (
                        <div>
                          <span className="text-muted-foreground">Model:</span> {run.model}
                        </div>
                      )}
                      {run.tokens_used != null && (
                        <div>
                          <span className="text-muted-foreground">Tokens:</span>{" "}
                          {run.tokens_used.toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
