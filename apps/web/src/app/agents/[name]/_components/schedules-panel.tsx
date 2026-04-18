"use client";

import * as React from "react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Clock } from "lucide-react";
import type { AgentSchedule, ThreadLifetime } from "../../../types/db";
import { createScheduleAction, updateScheduleAction, deleteScheduleAction } from "../../../actions";
import { CronDisplay } from "./cron-display";
import { CollapsibleSection, SummaryText } from "./collapsible-section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { isValidCron } from "@/lib/cron";
import { cn } from "@/lib/utils";

const NOTIFY_EXPIRES_OPTIONS = [
  { value: "1 hour", label: "1 hour" },
  { value: "24 hours", label: "24 hours" },
  { value: "72 hours", label: "72 hours (default)" },
  { value: "168 hours", label: "7 days" },
  { value: "720 hours", label: "30 days" },
  { value: "never", label: "No expiry" },
];

function ScheduleDialogBody({
  agentName,
  schedule,
  availableAgents,
  onClose,
  onSaved,
}: {
  agentName: string;
  schedule?: AgentSchedule;
  availableAgents: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const isEdit = !!schedule;
  const [name, setName] = useState(schedule?.name ?? "");
  const [cron, setCron] = useState(schedule?.cron ?? "");
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [threadLifetime, setThreadLifetime] = useState(schedule?.thread_lifetime ?? "");
  const [notify, setNotify] = useState<string[]>(schedule?.notify ?? []);
  const [notifyExpiresAfter, setNotifyExpiresAfter] = useState(
    schedule?.notify_expires_after === null
      ? "never"
      : (schedule?.notify_expires_after ?? "72 hours"),
  );

  const cronValid = cron.length > 0 && isValidCron(cron);
  const canSubmit = (isEdit || name.length > 0) && cronValid && prompt.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        if (isEdit && schedule) {
          await updateScheduleAction(schedule.id, agentName, {
            cron,
            prompt,
            thread_lifetime: (threadLifetime || null) as ThreadLifetime | null,
            notify,
            notify_expires_after: notifyExpiresAfter,
          });
          toast.success("Schedule updated");
        } else {
          await createScheduleAction({
            agent_name: agentName,
            name,
            cron,
            prompt,
            thread_lifetime: threadLifetime ? (threadLifetime as ThreadLifetime) : undefined,
            notify,
            notify_expires_after:
              notifyExpiresAfter !== "72 hours" ? notifyExpiresAfter : undefined,
          });
          toast.success("Schedule created");
        }
        onSaved();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save schedule");
      }
    });
  };

  const toggleNotify = (target: string) => {
    setNotify((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target],
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-2xl font-semibold tracking-tight">
          {isEdit ? "Edit schedule" : "New schedule"}
        </DialogTitle>
        <DialogDescription>Cron schedules trigger this agent automatically.</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[60vh] gap-4 overflow-y-auto py-2 pr-1">
        <div className="grid gap-1.5">
          <Label htmlFor="sched-name">Name</Label>
          <Input
            id="sched-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="daily_summary"
            disabled={isEdit}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sched-cron">Cron expression</Label>
          <Input
            id="sched-cron"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 7 * * *"
            className="font-mono"
          />
          {cron.length > 0 && cronValid ? (
            <CronDisplay expression={cron} />
          ) : cron.length > 0 ? (
            <p className="text-xs text-destructive">
              Invalid — expected 5 fields: minute hour day month weekday
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Standard cron: minute hour day month weekday
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sched-prompt">Prompt</Label>
          <textarea
            id="sched-prompt"
            rows={3}
            className="flex w-full rounded-sm border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What message to send the agent on each run..."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sched-thread">Thread lifetime override</Label>
          <Select
            id="sched-thread"
            value={threadLifetime}
            onChange={(e) => setThreadLifetime(e.target.value)}
          >
            <option value="">Use agent default</option>
            <option value="ephemeral">Ephemeral</option>
            <option value="daily">Daily</option>
            <option value="persistent">Persistent</option>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label>Notify on completion</Label>
          <div className="flex flex-wrap gap-1.5">
            {[
              "inbox",
              ...availableAgents.map((a) => `agent:${a}`),
              ...availableAgents.map((a) => `announce:${a}`),
            ].map((target) => {
              const active = notify.includes(target);
              return (
                <button
                  key={target}
                  type="button"
                  onClick={() => toggleNotify(target)}
                  className={cn(
                    "rounded-sm border px-2 py-0.5 text-xs transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                  )}
                >
                  {target}
                </button>
              );
            })}
          </div>
        </div>
        {notify.length > 0 && (
          <div className="grid gap-1.5">
            <Label htmlFor="sched-expires">Notification expiry</Label>
            <Select
              id="sched-expires"
              value={notifyExpiresAfter}
              onChange={(e) => setNotifyExpiresAfter(e.target.value)}
            >
              {NOTIFY_EXPIRES_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit || pending}>
          {pending ? "Saving…" : isEdit ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function SchedulesPanel({
  agentName,
  schedules: initialSchedules,
  availableAgents,
  delay = 0,
}: {
  agentName: string;
  schedules: AgentSchedule[];
  availableAgents: string[];
  delay?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [schedules, setSchedules] = useState(initialSchedules);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AgentSchedule | undefined>();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentName)}/schedules`);
      if (res.ok) setSchedules(await res.json());
    } catch {
      /* silent */
    }
  }, [agentName]);

  const toggle = (sched: AgentSchedule, enabled: boolean) => {
    startTransition(async () => {
      try {
        await updateScheduleAction(sched.id, agentName, { enabled });
        toast.success(`Schedule ${enabled ? "enabled" : "disabled"}`);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to toggle schedule");
      }
    });
  };

  const remove = (sched: AgentSchedule) => {
    if (!confirm(`Delete schedule "${sched.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteScheduleAction(sched.id, agentName);
        toast.success("Schedule deleted");
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete schedule");
      }
    });
  };

  const activeCount = schedules.filter((s) => s.enabled).length;
  const summary =
    schedules.length === 0 ? (
      <SummaryText>on-demand only</SummaryText>
    ) : (
      <>
        <SummaryText status={activeCount > 0 ? "ok" : "muted"}>{activeCount} active</SummaryText>
        {schedules.length - activeCount > 0 && (
          <SummaryText>{schedules.length - activeCount} disabled</SummaryText>
        )}
      </>
    );

  return (
    <>
      <CollapsibleSection
        eyebrow="Schedules"
        count={schedules.length}
        defaultOpen
        summary={summary}
        delay={delay}
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        }
      >
        {schedules.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            No schedules — this agent runs on demand.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {schedules.map((sched) => (
              <li
                key={sched.id}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13.5px] font-semibold">{sched.name}</div>
                  <CronDisplay expression={sched.cron} className="mt-0.5" />
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                    {sched.prompt}
                  </p>
                  {sched.notify && sched.notify.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sched.notify.map((t, i) => (
                        <code
                          key={i}
                          className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
                        >
                          {t}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Switch
                    checked={sched.enabled}
                    onCheckedChange={(v) => toggle(sched, v)}
                    disabled={pending}
                    aria-label="Enabled"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditing(sched);
                      setDialogOpen(true);
                    }}
                    aria-label="Edit schedule"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => remove(sched)}
                    disabled={pending}
                    aria-label="Delete schedule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <ScheduleDialogBody
            key={editing?.id ?? "new"}
            agentName={agentName}
            schedule={editing}
            availableAgents={availableAgents}
            onClose={() => setDialogOpen(false)}
            onSaved={refresh}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
