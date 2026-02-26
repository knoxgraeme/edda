"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  Clock,
  Inbox,
  List,
  CalendarClock,
  Archive,
  Moon,
  Bot,
  Activity,
} from "lucide-react";
import type { DashboardData, Item, TaskRun } from "../types/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateItemStatusAction } from "../actions";
import { formatDuration, statusVariant } from "@/lib/format";

function ItemRow({ item, showType }: { item: Item; showType?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const dueDate =
    typeof item.metadata?.due_date === "string" ? item.metadata.due_date : undefined;

  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">{item.content}</p>
        <div className="flex items-center gap-2 mt-1">
          {showType && (
            <Badge variant="secondary" className="text-xs">
              {item.type}
            </Badge>
          )}
          {dueDate && (
            <span className="text-xs text-muted-foreground">{dueDate}</span>
          )}
          {item.summary && (
            <span className="text-xs text-muted-foreground truncate">
              {item.summary}
            </span>
          )}
        </div>
      </div>
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => updateItemStatusAction(item.id, "done"))
                }
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mark as complete</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => updateItemStatusAction(item.id, "snoozed"))
                }
              >
                <Moon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Snooze until later</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => updateItemStatusAction(item.id, "archived"))
                }
              >
                <Archive className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Archive this item</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorClass =
    status === "completed"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "running"
          ? "bg-amber-500 animate-pulse"
          : "bg-muted-foreground";

  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${colorClass}`} />;
}

function SectionCard({
  title,
  icon: Icon,
  items,
  emptyContent,
  showType,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: Item[];
  emptyContent: React.ReactNode;
  showType?: boolean;
}) {
  return (
    <Card className="shadow-sm border-0 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
          {items.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {items.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyContent}</div>
        ) : (
          items.map((item) => (
            <ItemRow key={item.id} item={item} showType={showType} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardClient({
  data,
  pendingCount,
  recentRuns,
  activeCount,
}: {
  data: DashboardData;
  pendingCount: number;
  recentRuns: TaskRun[];
  activeCount: number;
}) {
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());

  const toggleList = (name: string) => {
    setExpandedLists((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const listNames = Object.keys(data.lists);
  const today = format(new Date(), "EEEE, MMMM d");

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        {pendingCount > 0 && (
          <Link href="/inbox">
            <Button variant="outline" size="sm" className="gap-2">
              <Inbox className="h-4 w-4" />
              {pendingCount} pending
            </Button>
          </Link>
        )}
      </div>

      <div className="grid gap-4">
        {/* Top two cards side by side on larger screens */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionCard
            title="Due Today"
            icon={CalendarClock}
            items={data.due_today}
            emptyContent="Nothing due today. Items with due dates will appear here."
          />

          <SectionCard
            title="Captured Today"
            icon={Clock}
            items={data.captured_today}
            emptyContent="Nothing captured yet today."
            showType
          />
        </div>

        <SectionCard
          title="Open Items"
          icon={CheckCircle2}
          items={data.open_items}
          emptyContent={
            <p>
              No open tasks or reminders. Capture something in chat to get started.{" "}
              <Link
                href="/"
                className="text-primary underline-offset-4 hover:underline"
              >
                Go to Chat
              </Link>
            </p>
          }
        />

        {listNames.length > 0 && (
          <Card className="shadow-sm border-0 hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <List className="h-4 w-4 text-muted-foreground" />
                Lists
                <Badge variant="secondary" className="ml-auto">
                  {listNames.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {listNames.map((name) => {
                const items = data.lists[name];
                const isExpanded = expandedLists.has(name);
                return (
                  <div key={name} className="border-b last:border-0">
                    <button
                      type="button"
                      className="flex items-center justify-between w-full py-2.5 text-sm font-medium hover:text-foreground/80"
                      onClick={() => toggleList(name)}
                    >
                      <span>{name}</span>
                      <Badge variant="secondary">{items.length}</Badge>
                    </button>
                    {isExpanded &&
                      items.map((item) => (
                        <ItemRow key={item.id} item={item} />
                      ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {data.pending_confirmations.length > 0 && (
          <SectionCard
            title="Pending Confirmations"
            icon={Inbox}
            items={data.pending_confirmations}
            emptyContent=""
            showType
          />
        )}

        {/* Agent Activity */}
        <Card className="shadow-sm border-0 hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-muted-foreground" />
              Agent Activity
              {activeCount > 0 && (
                <Badge className="ml-auto gap-1">
                  <Activity className="h-3 w-3" />
                  {activeCount} running
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent agent runs. Trigger a run from the{" "}
                <Link
                  href="/agents"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Agents page
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-2">
                {recentRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot status={run.status} />
                      <Badge
                        variant={statusVariant(run.status)}
                        className="text-xs"
                      >
                        {run.status}
                      </Badge>
                      <span className="font-medium truncate">{run.agent_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                      {run.duration_ms != null && (
                        <span>{formatDuration(run.duration_ms)}</span>
                      )}
                      {run.started_at && (
                        <span>
                          {formatDistanceToNow(new Date(run.started_at), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {recentRuns.length >= 5 && (
                  <Link href="/agents" className="text-xs text-muted-foreground hover:text-foreground">
                    View all agent activity
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
