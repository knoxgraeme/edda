"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  Play,
  Trash2,
  ChevronDown,
  ChevronRight,
  Plus,
  Clock,
  Pencil,
  Save,
  X,
  Radio,
} from "lucide-react";
import Link from "next/link";
import type { Agent, TaskRun, AgentSchedule, AgentChannel, ChannelPlatform, ThreadLifetime } from "../../types/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  toggleAgentAction,
  deleteAgentAction,
  updateAgentAction,
  createScheduleAction,
  updateScheduleAction,
  deleteScheduleAction,
  createChannelAction,
  updateChannelAction,
  deleteChannelAction,
} from "../../actions";
import { AVAILABLE_SKILLS, MODEL_KEYS, isValidCron } from "../../agents/constants";
import { formatDuration, statusVariant } from "@/lib/format";

// ─── Schedule Dialog ────────────────────────────────────────────────

function ScheduleDialogInner({
  onOpenChange,
  agentName,
  schedule,
  onSaved,
}: {
  onOpenChange: (open: boolean) => void;
  agentName: string;
  schedule?: AgentSchedule;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(schedule?.name ?? "");
  const [cron, setCron] = useState(schedule?.cron ?? "");
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [threadLifetime, setThreadLifetime] = useState(schedule?.thread_lifetime ?? "");

  const isEdit = !!schedule;
  const cronValid = cron.length > 0 && isValidCron(cron);
  const canSubmit = name.length > 0 && cronValid && prompt.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        if (isEdit) {
          await updateScheduleAction(schedule.id, agentName, {
            cron,
            prompt,
            thread_lifetime: (threadLifetime || null) as ThreadLifetime | null,
          });
          toast.success("Schedule updated");
        } else {
          await createScheduleAction({
            agent_name: agentName,
            name,
            cron,
            prompt,
            thread_lifetime: threadLifetime ? (threadLifetime as ThreadLifetime) : undefined,
          });
          toast.success("Schedule created");
        }
        onOpenChange(false);
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save schedule");
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit Schedule" : "Add Schedule"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update the schedule configuration."
            : "Create a new cron schedule for this agent."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label htmlFor="sched-name">Name</Label>
          <Input
            id="sched-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="daily_summary"
            disabled={isEdit}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sched-cron">Cron Expression</Label>
          <Input
            id="sched-cron"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 7 * * *"
          />
          {cron.length > 0 && !cronValid ? (
            <p className="text-xs text-destructive">
              Invalid cron expression — expected 5 fields: minute hour day month weekday
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Standard cron: minute hour day month weekday
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sched-prompt">Prompt</Label>
          <textarea
            id="sched-prompt"
            rows={3}
            className="flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What message to send the agent on each run..."
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sched-context">Thread Lifetime Override</Label>
          <Select
            id="sched-context"
            value={threadLifetime}
            onChange={(e) => setThreadLifetime(e.target.value)}
          >
            <option value="">Use agent default</option>
            <option value="ephemeral">Ephemeral</option>
            <option value="daily">Daily</option>
            <option value="persistent">Persistent</option>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
          {isPending ? "Saving..." : isEdit ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Wrapper that uses key-based remounting to reset form state on open/schedule change */
function ScheduleDialog({
  open,
  onOpenChange,
  agentName,
  schedule,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  schedule?: AgentSchedule;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ScheduleDialogInner
          key={schedule?.id ?? "new"}
          onOpenChange={onOpenChange}
          agentName={agentName}
          schedule={schedule}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────

function OverviewTab({
  agent,
  availableAgents,
  isTriggering,
  onTriggerRun,
  onDelete,
}: {
  agent: Agent;
  availableAgents: string[];
  isTriggering: boolean;
  onTriggerRun: () => void;
  onDelete: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  // Editable fields
  const [description, setDescription] = useState(agent.description);
  const [threadLifetime, setThreadLifetime] = useState(agent.thread_lifetime);
  const [trigger, setTrigger] = useState<"on_demand" | "schedule">(agent.trigger ?? "on_demand");
  const [modelKey, setModelKey] = useState(agent.model_settings_key ?? "");
  const [skills, setSkills] = useState<Set<string>>(new Set(agent.skills));
  const [tools, setTools] = useState(agent.tools.join(", "));
  const [subagents, setSubagents] = useState<Set<string>>(new Set(agent.subagents));
  const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt ?? "");

  const toggleSkill = (skill: string) => {
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  };

  const toggleSubagent = (name: string) => {
    setSubagents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        await updateAgentAction(agent.name, {
          description,
          thread_lifetime: threadLifetime,
          trigger: trigger as "on_demand" | "schedule",
          model_settings_key: modelKey || null,
          skills: Array.from(skills),
          tools: tools
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          subagents: Array.from(subagents),
          system_prompt: systemPrompt || null,
        });
        toast.success("Agent updated");
        setEditing(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update agent");
      }
    });
  };

  const stores = (agent.metadata?.stores ?? {}) as Record<string, string>;
  const retrievalCtx = agent.metadata?.retrieval_context as Record<string, unknown> | undefined;

  return (
    <div className="grid gap-4">
      {/* Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Configuration</CardTitle>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={isPending}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={isPending}>
                    <Save className="h-3.5 w-3.5 mr-1" />
                    {isPending ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {editing ? (
            <>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Thread Lifetime</Label>
                  <Select
                    value={threadLifetime}
                    onChange={(e) => setThreadLifetime(e.target.value as ThreadLifetime)}
                  >
                    <option value="ephemeral">Ephemeral</option>
                    <option value="daily">Daily</option>
                    <option value="persistent">Persistent</option>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Trigger</Label>
                  <Select value={trigger} onChange={(e) => setTrigger(e.target.value as "on_demand" | "schedule")}>
                    <option value="on_demand">On Demand</option>
                    <option value="schedule">Schedule</option>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Model Override</Label>
                <Select
                  value={modelKey}
                  onChange={(e) => setModelKey(e.target.value)}
                >
                  {MODEL_KEYS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Skills</Label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_SKILLS.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => toggleSkill(s.name)}
                      className="cursor-pointer"
                      title={s.description}
                    >
                      <Badge variant={skills.has(s.name) ? "default" : "outline"}>
                        {s.name}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Tools</Label>
                <Input
                  value={tools}
                  onChange={(e) => setTools(e.target.value)}
                  placeholder="Comma-separated tool names (empty = skill defaults)"
                />
              </div>
              {availableAgents.length > 0 && (
                <div className="grid gap-2">
                  <Label>Subagents</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableAgents.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleSubagent(name)}
                        className="cursor-pointer"
                      >
                        <Badge variant={subagents.has(name) ? "default" : "outline"}>
                          {name}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{agent.description}</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Thread lifetime:</span>{" "}
                  <Badge variant="outline">{agent.thread_lifetime}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Trigger:</span>{" "}
                  <Badge variant="outline">{agent.trigger ?? "on_demand"}</Badge>
                </div>
                {agent.model_settings_key && (
                  <div>
                    <span className="text-muted-foreground">Model:</span>{" "}
                    <code className="text-xs">{agent.model_settings_key}</code>
                  </div>
                )}
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Skills:</span>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {agent.skills.length > 0 ? (
                    agent.skills.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      None — click Edit to add skills
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Tools:</span>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {agent.tools.length > 0 ? (
                    agent.tools.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      Skill defaults
                    </span>
                  )}
                </div>
              </div>
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
            </>
          )}
        </CardContent>
      </Card>

      {/* System Prompt */}
      <Card>
        <CardHeader>
          <button
            className="flex items-center gap-1 text-sm font-semibold hover:text-foreground/80"
            onClick={() => setShowPrompt(!showPrompt)}
          >
            {showPrompt ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            System Prompt
          </button>
        </CardHeader>
        {showPrompt && (
          <CardContent>
            {editing ? (
              <div className="grid gap-2">
                <textarea
                  rows={8}
                  className="flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>
            ) : (
              <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-64">
                {agent.system_prompt || "No custom system prompt."}
              </pre>
            )}
          </CardContent>
        )}
      </Card>

      {/* Metadata */}
      {Object.keys(agent.metadata).length > 0 && (
        <Card>
          <CardHeader>
            <button
              className="flex items-center gap-1 text-sm font-semibold hover:text-foreground/80"
              onClick={() => setShowMetadata(!showMetadata)}
            >
              {showMetadata ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Metadata
            </button>
          </CardHeader>
          {showMetadata && (
            <CardContent className="grid gap-3">
              {Object.keys(stores).length > 0 && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Store Access
                  </span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {Object.entries(stores).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-xs">
                        {k}: {v}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {retrievalCtx && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Retrieval Context
                  </span>
                  <pre className="text-xs bg-muted rounded-md p-2 mt-1 whitespace-pre-wrap">
                    {JSON.stringify(retrievalCtx, null, 2)}
                  </pre>
                </div>
              )}
              {/* Show raw JSON only for unknown keys not covered by parsed sections */}
              {(() => {
                const meta = agent.metadata as Record<string, unknown>;
                const rest = Object.fromEntries(
                  Object.entries(meta).filter(([k]) => k !== "stores" && k !== "retrieval_context"),
                );
                return Object.keys(rest).length > 0 ? (
                  <>
                    <Separator />
                    <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-48">
                      {JSON.stringify(rest, null, 2)}
                    </pre>
                  </>
                ) : null;
              })()}
            </CardContent>
          )}
        </Card>
      )}

      {/* Actions */}
      <Card>
        <CardContent className="flex items-center gap-2 pt-6">
          <Button
            variant="outline"
            className="gap-1"
            onClick={onTriggerRun}
            disabled={isTriggering}
          >
            <Play className="h-3.5 w-3.5" />
            {isTriggering ? "Triggering..." : "Run Now"}
          </Button>
          <Button
            variant="ghost"
            className="gap-1 text-destructive hover:text-destructive ml-auto"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Schedules Tab ──────────────────────────────────────────────────

function SchedulesTab({
  agentName,
  schedules: initialSchedules,
}: {
  agentName: string;
  schedules: AgentSchedule[];
}) {
  const [isPending, startTransition] = useTransition();
  const [schedules, setSchedules] = useState(initialSchedules);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<AgentSchedule | undefined>();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentName)}/schedules`);
      if (res.ok) setSchedules(await res.json());
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.warn("Schedule refresh failed:", err);
    }
  }, [agentName]);

  const handleToggle = (sched: AgentSchedule, enabled: boolean) => {
    startTransition(async () => {
      try {
        await updateScheduleAction(sched.id, agentName, { enabled });
        toast.success(`Schedule ${enabled ? "enabled" : "disabled"}`);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to toggle schedule");
      }
    });
  };

  const handleDelete = (sched: AgentSchedule) => {
    if (!confirm(`Delete schedule "${sched.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteScheduleAction(sched.id, agentName);
        toast.success("Schedule deleted");
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete schedule");
      }
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Cron schedules trigger this agent automatically.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => {
            setEditingSchedule(undefined);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mb-2" />
            <p className="text-sm">No schedules configured.</p>
          </CardContent>
        </Card>
      ) : (
        schedules.map((sched) => (
          <Card key={sched.id}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{sched.name}</span>
                    <Badge variant="outline" className="text-xs font-mono">
                      {sched.cron}
                    </Badge>
                    {sched.thread_lifetime && (
                      <Badge variant="secondary" className="text-xs">
                        {sched.thread_lifetime}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {sched.prompt}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={sched.enabled}
                    onCheckedChange={(v) => handleToggle(sched, v)}
                    disabled={isPending}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingSchedule(sched);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(sched)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <ScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agentName={agentName}
        schedule={editingSchedule}
        onSaved={refresh}
      />
    </div>
  );
}

// ─── Channel Dialog ──────────────────────────────────────────────────

const PLATFORM_OPTIONS: { value: ChannelPlatform; label: string }[] = [
  { value: "telegram", label: "Telegram" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
];

function ChannelDialogInner({
  onOpenChange,
  agentName,
  channel,
  onSaved,
}: {
  onOpenChange: (open: boolean) => void;
  agentName: string;
  channel?: AgentChannel;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [platform, setPlatform] = useState<ChannelPlatform>(channel?.platform ?? "telegram");
  const [externalId, setExternalId] = useState(channel?.external_id ?? "");
  const [receiveAnnouncements, setReceiveAnnouncements] = useState(
    channel?.receive_announcements ?? false,
  );

  const isEdit = !!channel;
  const canSubmit = externalId.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        if (isEdit) {
          await updateChannelAction(channel.id, agentName, {
            receive_announcements: receiveAnnouncements,
          });
          toast.success("Channel updated");
        } else {
          await createChannelAction({
            agent_name: agentName,
            platform,
            external_id: externalId,
            receive_announcements: receiveAnnouncements,
          });
          toast.success("Channel linked");
        }
        onOpenChange(false);
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save channel");
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit Channel" : "Link Channel"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update the channel configuration."
            : "Link a chat channel to this agent for bidirectional messaging."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label htmlFor="ch-platform">Platform</Label>
          <Select
            id="ch-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ChannelPlatform)}
            disabled={isEdit}
          >
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ch-external-id">External ID</Label>
          <Input
            id="ch-external-id"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder={
              platform === "telegram"
                ? "-1001234567890:123"
                : platform === "slack"
                  ? "T01234:C56789"
                  : "123456789:987654321"
            }
            disabled={isEdit}
          />
          <p className="text-xs text-muted-foreground">
            {platform === "telegram"
              ? "Format: chat_id:thread_id (use 0 for DMs)"
              : platform === "slack"
                ? "Format: workspace_id:channel_id"
                : "Format: guild_id:channel_id"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="ch-announcements"
            checked={receiveAnnouncements}
            onCheckedChange={setReceiveAnnouncements}
          />
          <Label htmlFor="ch-announcements" className="cursor-pointer">
            Receive announcements
          </Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          When enabled, this channel receives proactive output from scheduled and notification-triggered runs.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
          {isPending ? "Saving..." : isEdit ? "Update" : "Link"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ChannelDialog({
  open,
  onOpenChange,
  agentName,
  channel,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  channel?: AgentChannel;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ChannelDialogInner
          key={channel?.id ?? "new"}
          onOpenChange={onOpenChange}
          agentName={agentName}
          channel={channel}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

// ─── Channels Tab ────────────────────────────────────────────────────

function ChannelsTab({
  agentName,
  channels: initialChannels,
}: {
  agentName: string;
  channels: AgentChannel[];
}) {
  const [isPending, startTransition] = useTransition();
  const [channels, setChannels] = useState(initialChannels);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<AgentChannel | undefined>();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/channels?agent_name=${encodeURIComponent(agentName)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setChannels(Array.isArray(data) ? data : data.data);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.warn("Channel refresh failed:", err);
    }
  }, [agentName]);

  const handleToggleEnabled = (ch: AgentChannel, enabled: boolean) => {
    startTransition(async () => {
      try {
        await updateChannelAction(ch.id, agentName, { enabled });
        toast.success(`Channel ${enabled ? "enabled" : "disabled"}`);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to toggle channel");
      }
    });
  };

  const handleToggleAnnouncements = (ch: AgentChannel, receiveAnnouncements: boolean) => {
    startTransition(async () => {
      try {
        await updateChannelAction(ch.id, agentName, {
          receive_announcements: receiveAnnouncements,
        });
        toast.success(`Announcements ${receiveAnnouncements ? "enabled" : "disabled"}`);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to toggle announcements");
      }
    });
  };

  const handleDelete = (ch: AgentChannel) => {
    if (!confirm(`Unlink this ${ch.platform} channel?`)) return;
    startTransition(async () => {
      try {
        await deleteChannelAction(ch.id, agentName);
        toast.success("Channel unlinked");
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete channel");
      }
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Linked chat channels for bidirectional messaging.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => {
            setEditingChannel(undefined);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Link Channel
        </Button>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Radio className="h-8 w-8 mb-2" />
            <p className="text-sm">No channels linked.</p>
            <p className="text-xs mt-1">
              Link a Telegram, Slack, or Discord channel to chat with this agent.
            </p>
          </CardContent>
        </Card>
      ) : (
        channels.map((ch) => (
          <Card key={ch.id} className={!ch.enabled ? "opacity-60" : undefined}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs capitalize">
                      {ch.platform}
                    </Badge>
                    <code className="text-xs text-muted-foreground">{ch.external_id}</code>
                    {ch.receive_announcements && (
                      <Badge variant="secondary" className="text-xs">
                        announcements
                      </Badge>
                    )}
                  </div>
                  {ch.config && Object.keys(ch.config).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {Object.entries(ch.config)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Enabled</span>
                      <Switch
                        checked={ch.enabled}
                        onCheckedChange={(v) => handleToggleEnabled(ch, v)}
                        disabled={isPending}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Announce</span>
                      <Switch
                        checked={ch.receive_announcements}
                        onCheckedChange={(v) => handleToggleAnnouncements(ch, v)}
                        disabled={isPending}
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingChannel(ch);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(ch)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <ChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agentName={agentName}
        channel={editingChannel}
        onSaved={refresh}
      />
    </div>
  );
}

// ─── Runs Tab ───────────────────────────────────────────────────────

function RunsTab({ agentName, runs: initialRuns }: { agentName: string; runs: TaskRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentName)}/runs?limit=20`,
      );
      if (res.ok) {
        const data = await res.json();
        setRuns(Array.isArray(data) ? data : data.data);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.warn("Runs polling failed:", err);
    }
  }, [agentName]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchRuns();
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchRuns();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchRuns]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run History</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="space-y-1">
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
                      {run.tokens_used != null && (
                        <span>{run.tokens_used.toLocaleString()} tok</span>
                      )}
                      <span>{formatDuration(run.duration_ms)}</span>
                      {run.started_at && (
                        <span>
                          {formatDistanceToNow(new Date(run.started_at), {
                            addSuffix: true,
                          })}
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
                        <span className="text-muted-foreground font-medium">Output:</span>
                        <p className="whitespace-pre-wrap mt-1">{run.output_summary}</p>
                      </div>
                    )}
                    {run.error && (
                      <div>
                        <span className="text-destructive font-medium">Error:</span>
                        <p className="whitespace-pre-wrap mt-1 text-destructive">
                          {run.error}
                        </p>
                      </div>
                    )}
                    <div className="flex gap-4 text-muted-foreground">
                      {run.model && <span>Model: {run.model}</span>}
                      {run.tokens_used != null && (
                        <span>Tokens: {run.tokens_used.toLocaleString()}</span>
                      )}
                      {run.input_summary && <span>Input: {run.input_summary}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function AgentDetailClient({
  agent,
  runs,
  schedules,
  channels,
  availableAgents,
}: {
  agent: Agent;
  runs: TaskRun[];
  schedules: AgentSchedule[];
  channels: AgentChannel[];
  availableAgents: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(agent.enabled);
  const [isTriggering, setIsTriggering] = useState(false);
  const triggeringRef = useRef(false);

  const triggerRun = useCallback(async () => {
    if (triggeringRef.current) return;
    triggeringRef.current = true;
    setIsTriggering(true);
    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(agent.name)}/run`, {
        method: "POST",
      });
      if (res.ok) toast.success(`${agent.name} triggered`);
      else toast.error(`Failed to trigger ${agent.name}`);
    } finally {
      triggeringRef.current = false;
      setIsTriggering(false);
    }
  }, [agent.name]);

  const handleToggle = (newEnabled: boolean) => {
    setEnabled(newEnabled);
    startTransition(async () => {
      try {
        await toggleAgentAction(agent.name, newEnabled);
      } catch (err) {
        setEnabled(!newEnabled);
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
        if (err && typeof err === "object" && "digest" in err) throw err;
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
            {enabled ? "Enabled" : "Disabled"}
          </Label>
          <Switch
            id="agent-enabled"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
          />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="schedules">
            Schedules
            {schedules.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">
                {schedules.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="channels">
            Channels
            {channels.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">
                {channels.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            agent={agent}
            availableAgents={availableAgents}
            isTriggering={isTriggering}
            onTriggerRun={triggerRun}
            onDelete={handleDelete}
          />
        </TabsContent>

        <TabsContent value="schedules">
          <SchedulesTab agentName={agent.name} schedules={schedules} />
        </TabsContent>

        <TabsContent value="channels">
          <ChannelsTab agentName={agent.name} channels={channels} />
        </TabsContent>

        <TabsContent value="runs">
          <RunsTab agentName={agent.name} runs={runs} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
