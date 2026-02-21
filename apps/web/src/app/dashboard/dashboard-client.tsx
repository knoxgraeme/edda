"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  CheckCircle2,
  Clock,
  Inbox,
  List,
  CalendarClock,
  Archive,
  Moon,
} from "lucide-react";
import type { DashboardData, Item } from "../types/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateItemStatusAction } from "../actions";

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
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={isPending}
          title="Complete"
          onClick={() =>
            startTransition(() => updateItemStatusAction(item.id, "done"))
          }
        >
          <CheckCircle2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={isPending}
          title="Snooze"
          onClick={() =>
            startTransition(() => updateItemStatusAction(item.id, "snoozed"))
          }
        >
          <Moon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={isPending}
          title="Archive"
          onClick={() =>
            startTransition(() => updateItemStatusAction(item.id, "archived"))
          }
        >
          <Archive className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  items,
  emptyMessage,
  showType,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: Item[];
  emptyMessage: string;
  showType?: boolean;
}) {
  return (
    <Card>
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
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
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
}: {
  data: DashboardData;
  pendingCount: number;
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
        <SectionCard
          title="Due Today"
          icon={CalendarClock}
          items={data.due_today}
          emptyMessage="Nothing due today."
        />

        <SectionCard
          title="Captured Today"
          icon={Clock}
          items={data.captured_today}
          emptyMessage="Nothing captured yet today."
          showType
        />

        <SectionCard
          title="Open Items"
          icon={CheckCircle2}
          items={data.open_items}
          emptyMessage="No open tasks or reminders."
        />

        {listNames.length > 0 && (
          <Card>
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
            emptyMessage=""
            showType
          />
        )}
      </div>
    </main>
  );
}
