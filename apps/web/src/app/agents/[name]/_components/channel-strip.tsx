"use client";

import * as React from "react";
import { useCallback, useState, useTransition } from "react";
import { Plus, Radio, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentChannel, ChannelPlatform } from "../../../types/db";
import { createChannelAction, deleteChannelAction } from "../../../actions";
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

const PLATFORM_OPTIONS: { value: ChannelPlatform; label: string }[] = [
  { value: "telegram", label: "Telegram" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
];

function channelLabel(ch: AgentChannel): string {
  const config = ch.config;
  if (config && typeof config.chat_title === "string") {
    const topic = typeof config.topic_name === "string" ? config.topic_name : null;
    return topic ? `${config.chat_title} #${topic}` : config.chat_title;
  }
  return ch.external_id;
}

function LinkDialogBody({
  agentName,
  onClose,
  onSaved,
}: {
  agentName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [platform, setPlatform] = useState<ChannelPlatform>("telegram");
  const [externalId, setExternalId] = useState("");
  const [receiveAnnouncements, setReceiveAnnouncements] = useState(false);

  const submit = () => {
    if (!externalId) return;
    startTransition(async () => {
      try {
        await createChannelAction({
          agent_name: agentName,
          platform,
          external_id: externalId,
          receive_announcements: receiveAnnouncements,
        });
        toast.success("Channel linked");
        onSaved();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to link channel");
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-2xl font-semibold tracking-tight">Link channel</DialogTitle>
        <DialogDescription>
          Link a chat channel to this agent for bidirectional messaging.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ch-platform">Platform</Label>
          <Select
            id="ch-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ChannelPlatform)}
          >
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
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
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {platform === "telegram"
              ? "chat_id:thread_id (or :dm for direct messages)"
              : platform === "slack"
                ? "workspace_id:channel_id"
                : "guild_id:channel_id"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="ch-announcements"
            checked={receiveAnnouncements}
            onCheckedChange={setReceiveAnnouncements}
          />
          <Label htmlFor="ch-announcements" className="cursor-pointer text-sm">
            Receive announcements
          </Label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!externalId || pending}>
          {pending ? "Linking…" : "Link"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Minimal one-line channel summary that sits at the very top of the
 * config panel. Channels belong to runtime, not config, so they get
 * the lightest treatment with a single "Link" button.
 */
export function ChannelStrip({
  agentName,
  channels: initialChannels,
}: {
  agentName: string;
  channels: AgentChannel[];
}) {
  const [channels, setChannels] = useState(initialChannels);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/channels?agent_name=${encodeURIComponent(agentName)}`);
      if (res.ok) {
        const data = await res.json();
        setChannels(data.data);
      }
    } catch {
      /* silent — refresh is best-effort */
    }
  }, [agentName]);

  const remove = (ch: AgentChannel) => {
    if (!confirm(`Unlink this ${ch.platform} channel?`)) return;
    startTransition(async () => {
      try {
        await deleteChannelAction(ch.id, agentName);
        toast.success("Channel unlinked");
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to unlink channel");
      }
    });
  };

  const linked = channels.length > 0;

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-6 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 text-muted-foreground">
          <Radio className="h-3.5 w-3.5 shrink-0" />
          {!linked ? (
            <>
              <span className="text-[13px]">No channels linked</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate text-xs text-muted-foreground/70">
                triggers the agent from inbox, slack, telegram…
              </span>
            </>
          ) : (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {channels.map((ch) => (
                <span
                  key={ch.id}
                  className={`group inline-flex items-center gap-1.5 rounded-sm border border-border bg-background px-2 py-0.5 font-mono text-[11.5px] ${
                    !ch.enabled ? "opacity-60" : ""
                  }`}
                >
                  <span className="text-muted-foreground">{ch.platform}</span>
                  <span className="text-foreground truncate max-w-[180px]">{channelLabel(ch)}</span>
                  <button
                    type="button"
                    onClick={() => remove(ch)}
                    disabled={pending}
                    className="ml-0.5 text-muted-foreground/60 hover:text-destructive"
                    aria-label="Unlink channel"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] gap-1 px-2 text-xs"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-3 w-3" />
          Link
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <LinkDialogBody
            key={dialogOpen ? "open" : "closed"}
            agentName={agentName}
            onClose={() => setDialogOpen(false)}
            onSaved={refresh}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
