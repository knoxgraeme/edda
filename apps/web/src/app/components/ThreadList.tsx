"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { Loader2, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ThreadItem } from "@/app/types/types";
import { useEddaThreads } from "@/app/hooks/useEddaThreads";

const GROUP_LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  older: "Older",
} as const;

function formatTime(date: Date, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return format(date, "HH:mm");
  if (days === 1) return "Yesterday";
  if (days < 7) return format(date, "EEEE");
  return format(date, "MM/dd");
}

function ErrorState({ onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">Couldn&apos;t load threads</p>
      <p className="mt-1 text-xs text-muted-foreground">Check that the server is running</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <MessageSquare className="mb-2 h-12 w-12 text-gray-300" />
      <p className="text-sm text-muted-foreground">No threads yet</p>
    </div>
  );
}

interface ThreadListProps {
  currentThreadId?: string;
  onThreadSelect: (id: string) => void;
  onClose?: () => void;
}

export function ThreadList({ currentThreadId, onThreadSelect, onClose }: ThreadListProps) {
  const { threads, error, isLoading, mutate } = useEddaThreads();

  const isEmpty = threads.length === 0;

  // Group threads by time
  const grouped = useMemo(() => {
    const now = new Date();
    const groups: Record<keyof typeof GROUP_LABELS, ThreadItem[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    threads.forEach((thread) => {
      const diff = now.getTime() - thread.updatedAt.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        groups.today.push(thread);
      } else if (days === 1) {
        groups.yesterday.push(thread);
      } else if (days < 7) {
        groups.week.push(thread);
      } else {
        groups.older.push(thread);
      }
    });

    return groups;
  }, [threads]);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="grid flex-shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-b border-border p-4">
        <h2 className="text-lg font-semibold tracking-tight">Threads</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => mutate()}
            className="h-8 px-2 text-xs text-muted-foreground"
            title="Refresh threads"
          >
            <Loader2 className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
              aria-label="Close threads sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="h-0 flex-1">
        {error && <ErrorState message={(error as Error).message} onRetry={() => mutate()} />}

        {!error && isLoading && isEmpty && <LoadingState />}

        {!error && !isLoading && isEmpty && <EmptyState />}

        {!error && !isEmpty && (
          <div className="box-border w-full max-w-full overflow-hidden p-2">
            {(Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>).map((group) => {
              const groupThreads = grouped[group];
              if (groupThreads.length === 0) return null;

              return (
                <div key={group} className="mb-4">
                  <h4 className="m-0 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABELS[group]}
                  </h4>
                  <div className="flex flex-col gap-1">
                    {groupThreads.map((thread) => (
                      <button
                        key={thread.id}
                        onClick={() => onThreadSelect(thread.id)}
                        className={cn(
                          "grid w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors duration-200 hover:bg-accent/50",
                          currentThreadId === thread.id
                            ? "border border-primary bg-accent"
                            : "border border-transparent bg-transparent"
                        )}
                        aria-current={currentThreadId === thread.id}
                      >
                        <div className="min-w-0 flex-1">
                          {/* Title + Timestamp Row */}
                          <div className="mb-1 flex items-center justify-between">
                            <h3 className="truncate text-sm font-semibold">{thread.title}</h3>
                            <span className="ml-2 flex-shrink-0 text-xs text-muted-foreground">
                              {formatTime(thread.updatedAt)}
                            </span>
                          </div>
                          {/* Description row */}
                          {thread.description && (
                            <div className="flex items-center justify-between">
                              <p className="flex-1 truncate text-sm text-muted-foreground">
                                {thread.description}
                              </p>
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
