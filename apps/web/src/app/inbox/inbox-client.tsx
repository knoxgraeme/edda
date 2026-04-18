"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, format } from "date-fns";
import {
  Check,
  X,
  CheckCheck,
  Bot,
  Clock,
  Repeat,
  AlertTriangle,
  Inbox as InboxIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatCountdown, humanizeCron } from "@/lib/cron";

/**
 * Format a recurrence string for display.
 *
 * Reminders can be either 5-field cron expressions ("0 15 * * 2") or
 * PostgreSQL interval strings ("1 day", "2 hours"). Humanize crons via
 * `humanizeCron`; fall back to "every {interval}" for anything else.
 */
function formatRecurrence(recurrence: string): string {
  const human = humanizeCron(recurrence);
  if (human !== recurrence) return human;
  return `every ${recurrence}`;
}

import {
  confirmPendingAction,
  rejectPendingAction,
  confirmAllPendingAction,
  dismissNotificationAction,
} from "../actions";
import type { Notification, PendingItem } from "../types/db";

// ─── Label humanization ─────────────────────────────────────────

const PENDING_TYPE_LABELS: Record<string, string> = {
  item_type: "New item type",
  entity: "New entity",
  paired_user: "Pairing request",
  item: "New item",
  item_types: "New item type",
  entities: "New entity",
  items: "New item",
  paired_users: "Pairing request",
  telegram_paired_users: "Telegram pairing",
};

const SOURCE_LABELS: Record<string, string> = {
  agent_run: "Agent run",
  scheduled_agent: "Scheduled run",
  reminder: "Reminder",
  system: "System",
  task: "Task",
};

function humanize(raw: string, map: Record<string, string>): string {
  return map[raw] ?? raw.replace(/_/g, " ");
}

// ─── Unified row shape ──────────────────────────────────────────
//
// Confirmations, notifications, and reminders have different schemas
// but should share a table render. Normalize into a discriminated
// union with a common `timestamp` field for sorting.

type InboxRow =
  | {
      kind: "confirmation";
      id: string;
      rowKey: string;
      timestamp: Date;
      title: string;
      subtitle?: string;
      source: string;
      priority: null;
      raw: PendingItem;
    }
  | {
      kind: "notification";
      id: string;
      rowKey: string;
      timestamp: Date;
      title: string;
      subtitle?: string;
      source: string;
      priority: string | null;
      raw: Notification;
    }
  | {
      kind: "reminder";
      id: string;
      rowKey: string;
      timestamp: Date;
      scheduledAt: Date | null;
      title: string;
      subtitle?: string;
      source: string;
      priority: string | null;
      recurrence: string | null;
      raw: Notification;
    };

function toRows(
  items: PendingItem[],
  notifications: Notification[],
  reminders: Notification[],
): InboxRow[] {
  const rows: InboxRow[] = [];

  for (const item of items) {
    rows.push({
      kind: "confirmation",
      id: item.id,
      rowKey: `c:${item.table}:${item.id}`,
      timestamp: new Date(item.createdAt),
      title: item.label,
      subtitle: item.pendingAction || item.description || undefined,
      source: humanize(item.type, PENDING_TYPE_LABELS),
      priority: null,
      raw: item,
    });
  }

  for (const n of notifications) {
    rows.push({
      kind: "notification",
      id: n.id,
      rowKey: `n:${n.id}`,
      timestamp: new Date(n.created_at),
      title: n.summary,
      source: humanize(n.source_type, SOURCE_LABELS),
      priority: n.priority,
      raw: n,
    });
  }

  for (const r of reminders) {
    rows.push({
      kind: "reminder",
      id: r.id,
      rowKey: `r:${r.id}`,
      timestamp: r.scheduled_at ? new Date(r.scheduled_at) : new Date(r.created_at),
      scheduledAt: r.scheduled_at ? new Date(r.scheduled_at) : null,
      title: r.summary,
      source: r.recurrence ? formatRecurrence(r.recurrence) : "One-time",
      priority: r.priority,
      recurrence: r.recurrence,
      raw: r,
    });
  }

  // Newest first, except reminders which sort by upcoming time
  return rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

// ─── Kind pill ──────────────────────────────────────────────────

function KindPill({ kind }: { kind: InboxRow["kind"] }) {
  const config: Record<
    InboxRow["kind"],
    { label: string; className: string }
  > = {
    confirmation: {
      label: "confirmation",
      className: "bg-accent-warm/10 text-accent-warm border-accent-warm/30",
    },
    notification: {
      label: "notification",
      className: "bg-foreground/5 text-foreground border-border",
    },
    reminder: {
      label: "reminder",
      className: "bg-muted text-muted-foreground border-border",
    },
  };
  const c = config[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[0.65rem] font-mono uppercase tracking-wide",
        c.className,
      )}
    >
      {c.label}
    </span>
  );
}

// ─── Filter chip row ────────────────────────────────────────────

type Filter = "all" | InboxRow["kind"];

function FilterChips({
  current,
  onChange,
  counts,
}: {
  current: Filter;
  onChange: (f: Filter) => void;
  counts: { all: number; confirmation: number; notification: number; reminder: number };
}) {
  const chips: { value: Filter; label: string }[] = [
    { value: "all", label: "all" },
    { value: "confirmation", label: "confirmations" },
    { value: "notification", label: "notifications" },
    { value: "reminder", label: "reminders" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {chips.map((chip) => {
        const active = current === chip.value;
        const count = counts[chip.value];
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onChange(chip.value)}
            className={cn(
              "rounded-sm border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground",
            )}
          >
            {chip.label}
            {count > 0 && (
              <span className="ml-1.5 font-mono text-[0.65rem]">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Detail drawer ──────────────────────────────────────────────

function ConfirmationDetail({
  row,
  onClose,
}: {
  row: Extract<InboxRow, { kind: "confirmation" }>;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const approve = () => {
    startTransition(async () => {
      try {
        await confirmPendingAction(row.raw.table, row.raw.id);
        toast.success("Approved");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to approve");
      }
    });
  };
  const reject = () => {
    if (!confirm(`Reject "${row.title}"?`)) return;
    startTransition(async () => {
      try {
        await rejectPendingAction(row.raw.table, row.raw.id);
        toast.success("Rejected");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to reject");
      }
    });
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2 pr-8">
          <KindPill kind="confirmation" />
          <span className="section-eyebrow !normal-case !tracking-normal">
            {row.source}
          </span>
        </div>
        <SheetTitle>{row.title}</SheetTitle>
        <SheetDescription>
          {formatDistanceToNow(row.timestamp, { addSuffix: true })} ·{" "}
          {format(row.timestamp, "MMM d, yyyy h:mm a")}
        </SheetDescription>
        <div className="mt-2 flex items-center gap-2">
          <Button className="gap-1" disabled={pending} onClick={approve}>
            <Check className="h-4 w-4" />
            Approve
          </Button>
          <Button
            variant="ghost"
            className="gap-1 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={reject}
          >
            <X className="h-4 w-4" />
            Reject
          </Button>
        </div>
      </SheetHeader>
      <SheetBody>
        {row.subtitle && (
          <div className="mb-5">
            <div className="section-eyebrow mb-1.5">Pending action</div>
            <p className="whitespace-pre-wrap text-sm">{row.subtitle}</p>
          </div>
        )}
        <div className="mb-5">
          <div className="section-eyebrow mb-1.5">Table</div>
          <code className="font-mono text-xs text-muted-foreground">
            {row.raw.table}
          </code>
        </div>
        <div>
          <div className="section-eyebrow mb-1.5">Raw id</div>
          <code className="font-mono text-xs text-muted-foreground">
            {row.raw.id}
          </code>
        </div>
      </SheetBody>
    </>
  );
}

function NotificationDetail({
  row,
  onClose,
}: {
  row: Extract<InboxRow, { kind: "notification" }>;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const dismiss = () => {
    startTransition(async () => {
      try {
        await dismissNotificationAction(row.id);
        toast.success("Dismissed");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to dismiss");
      }
    });
  };

  const isHigh = row.priority === "high";

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2 pr-8">
          <KindPill kind="notification" />
          <span className="section-eyebrow !normal-case !tracking-normal flex items-center gap-1">
            <Bot className="h-3 w-3" />
            {row.source}
          </span>
          {isHigh && (
            <span className="flex items-center gap-0.5 font-mono text-[0.7rem] text-accent-warm">
              <AlertTriangle className="h-3 w-3" />
              high
            </span>
          )}
        </div>
        <SheetTitle>{row.title}</SheetTitle>
        <SheetDescription>
          {formatDistanceToNow(row.timestamp, { addSuffix: true })} ·{" "}
          {format(row.timestamp, "MMM d, yyyy h:mm a")}
        </SheetDescription>
        <div className="mt-2 flex items-center gap-2">
          <Button
            className="gap-1"
            disabled={pending}
            onClick={dismiss}
          >
            <Check className="h-4 w-4" />
            Dismiss
          </Button>
        </div>
      </SheetHeader>
      <SheetBody>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {row.raw.summary}
        </div>
      </SheetBody>
    </>
  );
}

function ReminderDetail({
  row,
  onClose,
  now,
}: {
  row: Extract<InboxRow, { kind: "reminder" }>;
  onClose: () => void;
  now: number;
}) {
  const [pending, startTransition] = useTransition();
  const cancel = () => {
    if (!confirm("Cancel this reminder?")) return;
    startTransition(async () => {
      try {
        await dismissNotificationAction(row.id);
        toast.success("Cancelled");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to cancel");
      }
    });
  };

  const isHigh = row.priority === "high";

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2 pr-8">
          <KindPill kind="reminder" />
          {row.recurrence && (
            <span className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
              <Repeat className="h-3 w-3" />
              {formatRecurrence(row.recurrence)}
            </span>
          )}
          {isHigh && (
            <span className="flex items-center gap-0.5 font-mono text-[0.7rem] text-accent-warm">
              <AlertTriangle className="h-3 w-3" />
              high
            </span>
          )}
        </div>
        <SheetTitle>{row.title}</SheetTitle>
        <SheetDescription>
          {row.scheduledAt ? (
            <>
              {format(row.scheduledAt, "EEE MMM d, h:mm a")} ·{" "}
              <span className="font-mono">
                {formatCountdown(row.scheduledAt.getTime() - now)}
              </span>
            </>
          ) : (
            "Scheduling pending"
          )}
        </SheetDescription>
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={cancel}
          >
            <X className="h-4 w-4" />
            Cancel reminder
          </Button>
        </div>
      </SheetHeader>
      <SheetBody>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {row.raw.summary}
        </div>
      </SheetBody>
    </>
  );
}

// ─── Main ───────────────────────────────────────────────────────

export function InboxClient({
  items,
  notifications,
  reminders,
}: {
  items: PendingItem[];
  notifications: Notification[];
  reminders: Notification[];
}) {
  const router = useRouter();
  const [bulkPending, startBulk] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Shared clock for reminder countdowns (single interval for the
  // whole view).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Poll for new items every 30s while tab is visible.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  const allRows = useMemo(
    () => toRows(items, notifications, reminders),
    [items, notifications, reminders],
  );

  const counts = useMemo(
    () => ({
      all: allRows.length,
      confirmation: allRows.filter((r) => r.kind === "confirmation").length,
      notification: allRows.filter((r) => r.kind === "notification").length,
      reminder: allRows.filter((r) => r.kind === "reminder").length,
    }),
    [allRows],
  );

  const visibleRows = useMemo(
    () =>
      filter === "all" ? allRows : allRows.filter((r) => r.kind === filter),
    [allRows, filter],
  );

  const selectedRow = useMemo(
    () => allRows.find((r) => r.rowKey === selectedKey) ?? null,
    [allRows, selectedKey],
  );

  const closeDrawer = useCallback(() => setSelectedKey(null), []);

  const approveAll = useCallback(() => {
    if (!confirm(`Approve all ${items.length} confirmations?`)) return;
    startBulk(async () => {
      try {
        await confirmAllPendingAction(
          items.map((i) => ({ table: i.table, id: i.id })),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Approve all failed");
      }
    });
  }, [items]);

  return (
    <main className="flex h-full flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-6">
        <div>
          <div className="section-eyebrow">inbox</div>
          <h1 className="text-4xl font-bold leading-none tracking-tight">
            Unread
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {allRows.length > 0
              ? `${allRows.length} ${allRows.length === 1 ? "item" : "items"}`
              : "all caught up"}
          </span>
          {counts.confirmation >= 2 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={bulkPending}
              onClick={approveAll}
            >
              <CheckCheck className="h-3 w-3" />
              Approve all confirmations
            </Button>
          )}
        </div>
      </header>

      {/* ── Filter chips ───────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <FilterChips current={filter} onChange={setFilter} counts={counts} />
      </div>

      {/* ── Table ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {visibleRows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <InboxIcon className="h-8 w-8" />
            <p className="text-sm">
              {filter === "all"
                ? "All caught up."
                : `No ${filter}s.`}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="sticky top-0 z-[1] bg-background">
              <tr className="border-b border-border">
                <th className="section-eyebrow px-6 py-2 font-normal">Type</th>
                <th className="section-eyebrow px-2 py-2 font-normal">
                  Subject
                </th>
                <th className="section-eyebrow px-2 py-2 font-normal">
                  Source
                </th>
                <th className="section-eyebrow px-6 py-2 text-right font-normal">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isHigh = row.priority === "high";
                const isSelected = row.rowKey === selectedKey;
                return (
                  <tr
                    key={row.rowKey}
                    onClick={() => setSelectedKey(row.rowKey)}
                    className={cn(
                      "group cursor-pointer border-b border-border/60 transition-colors",
                      isSelected
                        ? "bg-accent-warm/10"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <td className="relative px-6 py-3 align-top">
                      {isHigh && (
                        <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent-warm" />
                      )}
                      <KindPill kind={row.kind} />
                    </td>
                    <td className="px-2 py-3 align-top">
                      <div className="text-sm text-foreground">{row.title}</div>
                      {row.subtitle && (
                        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {row.subtitle}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 align-top text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        {row.kind === "notification" && (
                          <Bot className="h-3 w-3" />
                        )}
                        {row.kind === "reminder" && (
                          <Clock className="h-3 w-3" />
                        )}
                        <span className="truncate">{row.source}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right align-top">
                      {row.kind === "reminder" && row.scheduledAt ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span className="text-xs text-foreground">
                            {format(row.scheduledAt, "EEE h:mm a")}
                          </span>
                          <span className="font-mono text-[0.65rem] text-muted-foreground">
                            {formatCountdown(row.scheduledAt.getTime() - now)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(row.timestamp, {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Detail drawer ──────────────────────────────────── */}
      <Sheet
        open={!!selectedRow}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      >
        <SheetContent>
          {selectedRow?.kind === "confirmation" && (
            <ConfirmationDetail row={selectedRow} onClose={closeDrawer} />
          )}
          {selectedRow?.kind === "notification" && (
            <NotificationDetail row={selectedRow} onClose={closeDrawer} />
          )}
          {selectedRow?.kind === "reminder" && (
            <ReminderDetail
              row={selectedRow}
              onClose={closeDrawer}
              now={now}
            />
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
