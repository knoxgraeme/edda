"use client";

import { useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, X, CheckCheck, Inbox, Bell, Bot, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  confirmPendingAction,
  rejectPendingAction,
  confirmAllPendingAction,
  dismissNotificationAction,
} from "../actions";
import type { Notification, PendingItem } from "../types/db";

function PendingRow({ item }: { item: PendingItem }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="text-xs">
              {item.type}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(item.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>
          <p className="text-sm font-medium">{item.label}</p>
          {item.pendingAction && (
            <p className="text-sm text-muted-foreground mt-1">
              {item.pendingAction}
            </p>
          )}
          {item.description && !item.pendingAction && (
            <p className="text-sm text-muted-foreground mt-1">
              {item.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={isPending}
            onClick={() =>
              startTransition(() =>
                confirmPendingAction(item.table, item.id),
              )
            }
          >
            <Check className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-destructive hover:text-destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(() =>
                rejectPendingAction(item.table, item.id),
              )
            }
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationRow({ notification }: { notification: Notification }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs gap-1">
              <Bot className="h-3 w-3" />
              {notification.source_type}
            </Badge>
            {notification.priority === "high" && (
              <Badge variant="destructive" className="text-xs gap-1">
                <AlertTriangle className="h-3 w-3" />
                high
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(notification.created_at), {
                addSuffix: true,
              })}
            </span>
          </div>
          <p className="text-sm">{notification.summary}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              try {
                await dismissNotificationAction(notification.id);
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to dismiss",
                );
              }
            })
          }
        >
          <Check className="h-3.5 w-3.5" />
          Dismiss
        </Button>
      </CardContent>
    </Card>
  );
}

export function InboxClient({
  items,
  notifications,
}: {
  items: PendingItem[];
  notifications: Notification[];
}) {
  const [isPending, startTransition] = useTransition();
  const totalCount = items.length + notifications.length;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Inbox</h1>
          {totalCount > 0 && <Badge>{totalCount}</Badge>}
        </div>
      </div>

      <Tabs defaultValue={items.length > 0 ? "confirmations" : "notifications"}>
        <TabsList>
          <TabsTrigger value="confirmations">
            Confirmations
            {items.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">
                {items.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="notifications">
            Notifications
            {notifications.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">
                {notifications.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="confirmations">
          <div className="grid gap-3">
            {items.length > 1 && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(() =>
                      confirmAllPendingAction(
                        items.map((i) => ({ table: i.table, id: i.id })),
                      ),
                    )
                  }
                >
                  <CheckCheck className="h-4 w-4" />
                  Approve All
                </Button>
              </div>
            )}
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Inbox className="h-10 w-10 mb-3" />
                <p className="text-sm font-medium">No pending confirmations.</p>
                <p className="text-sm mt-1 max-w-sm text-center">
                  When agents want to create new item types or merge entities, you&apos;ll approve them
                  here.
                </p>
              </div>
            ) : (
              items.map((item) => (
                <PendingRow key={`${item.table}-${item.id}`} item={item} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <div className="grid gap-3">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bell className="h-10 w-10 mb-3" />
                <p className="text-sm font-medium">No notifications yet.</p>
                <p className="text-sm mt-1 max-w-sm text-center">
                  You&apos;ll see updates here when agent runs complete or need your attention.
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationRow key={n.id} notification={n} />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
