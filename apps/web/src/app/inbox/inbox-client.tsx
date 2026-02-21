"use client";

import { useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, X, CheckCheck, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  confirmPendingAction,
  rejectPendingAction,
  confirmAllPendingAction,
} from "../actions";
import type { PendingItem } from "../types/db";

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

export function InboxClient({ items }: { items: PendingItem[] }) {
  const [isPending, startTransition] = useTransition();

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Inbox</h1>
          {items.length > 0 && (
            <Badge>{items.length}</Badge>
          )}
        </div>
        {items.length > 1 && (
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
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Inbox className="h-12 w-12 mb-4" />
          <p className="text-lg font-medium">All caught up</p>
          <p className="text-sm">No pending confirmations.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <PendingRow key={`${item.table}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
