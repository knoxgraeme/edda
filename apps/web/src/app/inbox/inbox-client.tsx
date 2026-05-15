"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict, format } from "date-fns";
import {
  Check,
  X,
  Clock,
  Repeat,
  AlertTriangle,
  Inbox as InboxIcon,
  Cloud,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatCountdown, humanizeCron } from "@/lib/cron";

import {
  confirmPendingAction,
  rejectPendingAction,
  confirmAllPendingAction,
  dismissNotificationAction,
} from "../actions";
import type { Notification, PendingItem } from "../types/db";

// ─── Helpers ─────────────────────────────────────────────────────

function formatRecurrence(recurrence: string): string {
  const human = humanizeCron(recurrence);
  if (human !== recurrence) return human;
  return `every ${recurrence}`;
}

/** Compact "18h ago" style. */
function shortAgo(date: Date): string {
  return `${formatDistanceToNowStrict(date)} ago`;
}

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

// ─── Unified row shape ───────────────────────────────────────────

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

  return rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

const SOURCE_ICON: Record<InboxRow["kind"], LucideIcon> = {
  notification: Cloud,
  reminder: Clock,
  confirmation: Sparkles,
};

// ─── Presentational bits ─────────────────────────────────────────

function TypeChip({ kind, compact }: { kind: InboxRow["kind"]; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-sm border border-border bg-muted",
        "font-mono font-medium uppercase tracking-[0.08em] text-muted-foreground",
        compact ? "px-1.5 py-[2px] text-[10px]" : "px-[7px] py-[3px] text-[10px]",
      )}
    >
      {kind}
    </span>
  );
}

function TabPill({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground shadow-xs hover:bg-muted/60",
      )}
    >
      <span>{children}</span>
      {count != null && count > 0 && (
        <span
          className={cn(
            "font-mono text-[11px] font-medium",
            active ? "opacity-85" : "opacity-70",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function Checkbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-colors",
        checked || indeterminate
          ? "border-primary bg-primary text-primary-foreground"
          : "border-neutral-300 bg-background",
      )}
    >
      {indeterminate ? (
        <span className="block h-[2px] w-2 rounded-[1px] bg-primary-foreground" />
      ) : checked ? (
        <Check className="h-[11px] w-[11px]" strokeWidth={3} />
      ) : null}
    </button>
  );
}

// ─── Filter chips ────────────────────────────────────────────────

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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TabPill
        active={current === "all"}
        onClick={() => onChange("all")}
        count={counts.all}
      >
        all
      </TabPill>
      <TabPill
        active={current === "confirmation"}
        onClick={() => onChange("confirmation")}
        count={counts.confirmation || undefined}
      >
        confirmations
      </TabPill>
      <TabPill
        active={current === "notification"}
        onClick={() => onChange("notification")}
        count={counts.notification || undefined}
      >
        notifications
      </TabPill>
      <TabPill
        active={current === "reminder"}
        onClick={() => onChange("reminder")}
        count={counts.reminder || undefined}
      >
        reminders
      </TabPill>
    </div>
  );
}

// ─── Detail panel ────────────────────────────────────────────────

function MetaBar({
  row,
  onClose,
  action,
}: {
  row: InboxRow;
  onClose: () => void;
  action?: React.ReactNode;
}) {
  const SourceIcon = SOURCE_ICON[row.kind];
  const idLabel =
    row.kind === "confirmation"
      ? `${row.raw.table}_${row.raw.id.slice(0, 6)}`
      : `notif_${row.id.slice(0, 6)}`;
  const isHigh = row.kind !== "confirmation" && row.priority === "high";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-6 py-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <TypeChip kind={row.kind} compact />
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <SourceIcon className="h-3 w-3" />
          <span>{row.source}</span>
        </span>
        <span className="h-[3px] w-[3px] rounded-full bg-neutral-300" />
        <span className="font-mono text-xs text-muted-foreground">{idLabel}</span>
        {row.kind !== "confirmation" && (
          <>
            <span className="h-[3px] w-[3px] rounded-full bg-neutral-300" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent-warm">
              unread
            </span>
          </>
        )}
        {isHigh && (
          <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-accent-warm">
            <AlertTriangle className="h-3 w-3" />
            high
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {action}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  );
}

function DetailBody({
  title,
  timestamp,
  body,
  scheduledAt,
  recurrence,
  now,
}: {
  title: string;
  timestamp: Date;
  body: string;
  scheduledAt?: Date | null;
  recurrence?: string | null;
  now?: number;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 pb-10 pt-6">
      <h2 className="m-0 text-[22px] font-bold leading-[1.3] tracking-[-0.01em] text-pretty">
        {title}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[12px] text-muted-foreground">
        <span>{formatDistanceToNowStrict(timestamp, { addSuffix: true })}</span>
        <span className="text-neutral-300">·</span>
        <span>{format(timestamp, "MMM d, yyyy h:mm a")}</span>
        {scheduledAt && now != null && (
          <>
            <span className="text-neutral-300">·</span>
            <span>{formatCountdown(scheduledAt.getTime() - now)}</span>
          </>
        )}
        {recurrence && (
          <>
            <span className="text-neutral-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Repeat className="h-3 w-3" />
              {formatRecurrence(recurrence)}
            </span>
          </>
        )}
      </div>
      <div className="mt-5 whitespace-pre-wrap border-t border-neutral-100 pt-5 text-sm leading-[1.65] text-foreground text-pretty">
        {body}
      </div>
    </div>
  );
}

function ConfirmationDetail({
  row,
  onClose,
}: {
  row: Extract<InboxRow, { kind: "confirmation" }>;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const approve = () =>
    startTransition(async () => {
      try {
        await confirmPendingAction(row.raw.table, row.raw.id);
        toast.success("Approved");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to approve");
      }
    });
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
      <MetaBar
        row={row}
        onClose={onClose}
        action={
          <div className="inline-flex items-center gap-1.5">
            <Button size="sm" className="h-[30px] gap-1" disabled={pending} onClick={approve}>
              <Check className="h-[13px] w-[13px]" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-[30px]"
              disabled={pending}
              onClick={reject}
            >
              Reject
            </Button>
          </div>
        }
      />
      <DetailBody
        title={row.title}
        timestamp={row.timestamp}
        body={row.subtitle || `Pending approval in ${row.raw.table}.`}
      />
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
  const dismiss = () =>
    startTransition(async () => {
      try {
        await dismissNotificationAction(row.id);
        toast.success("Dismissed");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to dismiss");
      }
    });

  return (
    <>
      <MetaBar
        row={row}
        onClose={onClose}
        action={
          <Button size="sm" className="h-[30px] gap-1" disabled={pending} onClick={dismiss}>
            <Check className="h-[13px] w-[13px]" />
            Dismiss
          </Button>
        }
      />
      <DetailBody title={row.title} timestamp={row.timestamp} body={row.raw.summary} />
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

  return (
    <>
      <MetaBar
        row={row}
        onClose={onClose}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-[30px] gap-1 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={cancel}
          >
            <X className="h-[13px] w-[13px]" />
            Cancel
          </Button>
        }
      />
      <DetailBody
        title={row.title}
        timestamp={row.timestamp}
        body={row.raw.summary}
        scheduledAt={row.scheduledAt}
        recurrence={row.recurrence}
        now={now}
      />
    </>
  );
}

// ─── Bulk action bar ─────────────────────────────────────────────

function BulkBar({
  count,
  onClear,
  selectionKinds,
  onDismiss,
  onApprove,
  onReject,
  pending,
}: {
  count: number;
  onClear: () => void;
  selectionKinds: Set<InboxRow["kind"]>;
  onDismiss: () => void;
  onApprove: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  const hasConfirmations = selectionKinds.has("confirmation");
  const hasDismissable =
    selectionKinds.has("notification") || selectionKinds.has("reminder");

  return (
    <div className="inline-flex items-center gap-3 whitespace-nowrap rounded-lg bg-primary px-3.5 py-2 text-primary-foreground shadow-md">
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] opacity-85 hover:opacity-100"
      >
        <X className="h-[14px] w-[14px]" />
      </button>
      <span className="text-[13px] font-medium">{count} selected</span>
      <span className="h-[18px] w-px bg-primary-foreground/25" />
      {hasDismissable && (
        <button
          type="button"
          disabled={pending}
          onClick={onDismiss}
          className="inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-[5px] text-[13px] font-medium opacity-90 transition-opacity hover:bg-primary-foreground/10 hover:opacity-100 disabled:opacity-50"
        >
          <Check className="h-[13px] w-[13px]" />
          Dismiss
        </button>
      )}
      {hasConfirmations && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={onApprove}
            className="inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-[5px] text-[13px] font-medium opacity-90 transition-opacity hover:bg-primary-foreground/10 hover:opacity-100 disabled:opacity-50"
          >
            <Check className="h-[13px] w-[13px]" />
            Approve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onReject}
            className="inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-[5px] text-[13px] font-medium opacity-90 transition-opacity hover:bg-primary-foreground/10 hover:opacity-100 disabled:opacity-50"
          >
            <X className="h-[13px] w-[13px]" />
            Reject
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────

// Column widths: [checkbox, type-chip, subject (flex), source, when]
const GRID = "grid-cols-[24px_92px_minmax(0,1fr)_100px_110px]";

const HEADERS: { label: string; align: "left" | "right" }[] = [
  { label: "Type", align: "left" },
  { label: "Subject", align: "left" },
  { label: "Source", align: "left" },
  { label: "When", align: "right" },
];

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
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [bulkPending, startBulk] = useTransition();

  // Shared clock for reminder countdowns
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Throttle visibility-triggered refreshes to at most once per 10s (F12)
  const lastRefreshRef = React.useRef(0);

  // Poll for new items every 30s while tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        lastRefreshRef.current = Date.now();
        router.refresh();
      }
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastRefreshRef.current >= 10_000) {
          lastRefreshRef.current = now;
          router.refresh();
        }
      }
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
    () => (filter === "all" ? allRows : allRows.filter((r) => r.kind === filter)),
    [allRows, filter],
  );

  const selectedRow = useMemo(
    () => allRows.find((r) => r.rowKey === selectedKey) ?? null,
    [allRows, selectedKey],
  );

  // Memoize visible keys so toggleAll's useCallback dep is stable (F4)
  const visibleKeys = useMemo(() => visibleRows.map((r) => r.rowKey), [visibleRows]);
  const checkedInView = useMemo(
    () => visibleKeys.filter((k) => checkedKeys.has(k)),
    [visibleKeys, checkedKeys],
  );
  const allChecked = visibleKeys.length > 0 && checkedInView.length === visibleKeys.length;
  const someChecked = checkedInView.length > 0 && !allChecked;

  const selectionKinds = useMemo(() => {
    const set = new Set<InboxRow["kind"]>();
    for (const row of allRows) {
      if (checkedKeys.has(row.rowKey)) set.add(row.kind);
    }
    return set;
  }, [allRows, checkedKeys]);

  const toggleOne = useCallback((key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (allChecked) visibleKeys.forEach((k) => next.delete(k));
      else visibleKeys.forEach((k) => next.add(k));
      return next;
    });
  }, [allChecked, visibleKeys]);

  const clearChecked = useCallback(() => setCheckedKeys(new Set()), []);
  const closeDrawer = useCallback(() => setSelectedKey(null), []);

  // Clear selection when filter changes (F6)
  const handleFilterChange = useCallback((f: Filter) => {
    setFilter(f);
    setCheckedKeys(new Set());
  }, []);

  const selectedRows = useMemo(
    () => allRows.filter((r) => checkedKeys.has(r.rowKey)),
    [allRows, checkedKeys],
  );

  // F1: only deselect succeeded keys; F7: wrapped in useCallback
  const bulkDismiss = useCallback(
    () =>
      startBulk(async () => {
        const targets = selectedRows.filter(
          (r) => r.kind === "notification" || r.kind === "reminder",
        );
        if (targets.length === 0) return;
        const results = await Promise.allSettled(
          targets.map((r) => dismissNotificationAction(r.id)),
        );
        const succeededKeys = new Set(
          targets
            .filter((_, i) => results[i].status === "fulfilled")
            .map((r) => r.rowKey),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed === 0) toast.success(`Dismissed ${targets.length}`);
        else toast.error(`${failed} of ${targets.length} failed to dismiss`);
        setCheckedKeys((prev) => {
          const next = new Set(prev);
          succeededKeys.forEach((k) => next.delete(k));
          return next;
        });
      }),
    [selectedRows, startBulk],
  );

  // F1: clearChecked only on success; F7: wrapped in useCallback
  const bulkApprove = useCallback(
    () =>
      startBulk(async () => {
        const targets = selectedRows.filter(
          (r): r is Extract<InboxRow, { kind: "confirmation" }> =>
            r.kind === "confirmation",
        );
        if (targets.length === 0) return;
        try {
          await confirmAllPendingAction(
            targets.map((r) => ({ table: r.raw.table, id: r.raw.id })),
          );
          toast.success(`Approved ${targets.length}`);
          clearChecked();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to approve");
        }
      }),
    [selectedRows, clearChecked, startBulk],
  );

  // F2: confirm() before startBulk; F1: only deselect succeeded; F7: useCallback
  const bulkReject = useCallback(() => {
    const targets = selectedRows.filter(
      (r): r is Extract<InboxRow, { kind: "confirmation" }> =>
        r.kind === "confirmation",
    );
    if (targets.length === 0) return;
    if (!confirm(`Reject ${targets.length} confirmation(s)?`)) return;
    startBulk(async () => {
      const results = await Promise.allSettled(
        targets.map((r) => rejectPendingAction(r.raw.table, r.raw.id)),
      );
      const succeededKeys = new Set(
        targets
          .filter((_, i) => results[i].status === "fulfilled")
          .map((r) => r.rowKey),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === 0) toast.success(`Rejected ${targets.length}`);
      else toast.error(`${failed} of ${targets.length} failed to reject`);
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        succeededKeys.forEach((k) => next.delete(k));
        return next;
      });
    });
  }, [selectedRows, startBulk]);

  return (
    <main className="relative flex h-full min-w-0 flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-7 pb-20 pt-7">
          <h1 className="m-0 text-[30px] font-bold leading-none tracking-[-0.02em]">
            Inbox
          </h1>

          <FilterChips current={filter} onChange={handleFilterChange} counts={counts} />

          <div className="relative border-y border-border">
            {/* Column headers */}
            <div
              className={cn(
                "grid gap-3.5 border-b border-border bg-background px-3.5 py-2.5",
                GRID,
              )}
            >
              <div onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={toggleAll}
                  ariaLabel="Select all"
                />
              </div>
              {HEADERS.map(({ label, align }) => (
                <div
                  key={label}
                  className={cn(
                    "font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground",
                    align === "right" && "text-right",
                  )}
                >
                  {label}
                </div>
              ))}
            </div>

            {visibleRows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-16 text-center text-muted-foreground">
                <InboxIcon className="h-7 w-7" />
                <p className="text-sm">
                  {filter === "all" ? "All caught up." : `No ${filter}s.`}
                </p>
              </div>
            ) : (
              visibleRows.map((row) => {
                const isChecked = checkedKeys.has(row.rowKey);
                const isActiveDetail = row.rowKey === selectedKey;
                const SourceIcon = SOURCE_ICON[row.kind];
                return (
                  <div
                    key={row.rowKey}
                    onClick={() => setSelectedKey(row.rowKey)}
                    className={cn(
                      "grid cursor-pointer items-center gap-3.5 border-b border-neutral-100 px-3.5 py-3.5 transition-colors",
                      GRID,
                      "border-l-2 border-l-accent-warm -ml-[2px]",
                      isActiveDetail
                        ? "bg-accent-warm/10"
                        : isChecked
                          ? "bg-muted/60"
                          : "hover:bg-muted/40",
                    )}
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isChecked}
                        onChange={() => toggleOne(row.rowKey)}
                        ariaLabel={`Select ${row.title}`}
                      />
                    </div>
                    <div>
                      <TypeChip kind={row.kind} />
                    </div>
                    <div className="truncate text-sm font-medium text-foreground">
                      {row.title}
                    </div>
                    <div className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                      <SourceIcon className="h-[13px] w-[13px] shrink-0" />
                      <span className="truncate">{row.source}</span>
                    </div>
                    <div className="truncate text-right font-mono text-[13px] text-muted-foreground">
                      {row.kind === "reminder" && row.scheduledAt ? (
                        <span>{formatCountdown(row.scheduledAt.getTime() - now)}</span>
                      ) : (
                        shortAgo(row.timestamp)
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Floating bulk action bar */}
      {selectedRows.length > 0 && (
        <div className="pointer-events-none fixed bottom-6 left-0 right-0 z-30 flex justify-center">
          <div className="pointer-events-auto">
            <BulkBar
              count={selectedRows.length}
              onClear={clearChecked}
              selectionKinds={selectionKinds}
              onDismiss={bulkDismiss}
              onApprove={bulkApprove}
              onReject={bulkReject}
              pending={bulkPending}
            />
          </div>
        </div>
      )}

      {/* Detail slide-over */}
      <Sheet
        open={!!selectedRow}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      >
        <SheetContent className="!max-w-[min(560px,55vw)] p-0" hideCloseButton>
          {selectedRow?.kind === "confirmation" && (
            <ConfirmationDetail row={selectedRow} onClose={closeDrawer} />
          )}
          {selectedRow?.kind === "notification" && (
            <NotificationDetail row={selectedRow} onClose={closeDrawer} />
          )}
          {selectedRow?.kind === "reminder" && (
            <ReminderDetail row={selectedRow} onClose={closeDrawer} now={now} />
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
