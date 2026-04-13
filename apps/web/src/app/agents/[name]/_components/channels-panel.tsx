"use client";

import * as React from "react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Radio } from "lucide-react";
import type { AgentChannel, ChannelPlatform } from "../../../types/db";
import {
  createChannelAction,
  updateChannelAction,
  deleteChannelAction,
} from "../../../actions";
import { Section } from "@/app/components/section";
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

/** Platform glyph — simple shape mark since we don't have brand icons installed. */
function PlatformMark({ platform }: { platform: ChannelPlatform }) {
  const colors: Record<ChannelPlatform, string> = {
    telegram: "bg-[#229ED9]",
    slack: "bg-[#4A154B]",
    discord: "bg-[#5865F2]",
  };
  const letters: Record<ChannelPlatform, string> = {
    telegram: "T",
    slack: "S",
    discord: "D",
  };
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-sm text-[0.65rem] font-semibold text-white shrink-0 ${colors[platform]}`}
      aria-hidden
    >
      {letters[platform]}
    </span>
  );
}

/** Prefer human-readable config values (chat_title, topic_name) over raw external_id. */
function channelLabel(channel: AgentChannel): { primary: string; secondary: string } {
  const config = channel.config as Record<string, unknown> | null;
  if (config) {
    const title = typeof config.chat_title === "string" ? config.chat_title : null;
    const topic = typeof config.topic_name === "string" ? config.topic_name : null;
    if (title && topic) return { primary: title, secondary: `#${topic}` };
    if (title) return { primary: title, secondary: channel.external_id };
  }
  return { primary: channel.external_id, secondary: channel.platform };
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
        toast.error(
          err instanceof Error ? err.message : "Failed to link channel",
        );
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Link channel</DialogTitle>
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

export function ChannelsPanel({
  agentName,
  channels: initialChannels,
  delay = 0,
}: {
  agentName: string;
  channels: AgentChannel[];
  delay?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [channels, setChannels] = useState(initialChannels);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/channels?agent_name=${encodeURIComponent(agentName)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setChannels(data.data);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development")
        console.warn("Channel refresh failed:", err);
    }
  }, [agentName]);

  const toggleEnabled = (ch: AgentChannel, enabled: boolean) => {
    startTransition(async () => {
      try {
        await updateChannelAction(ch.id, agentName, { enabled });
        toast.success(`Channel ${enabled ? "enabled" : "disabled"}`);
        await refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to toggle channel",
        );
      }
    });
  };

  const toggleAnnounce = (ch: AgentChannel, receiveAnnouncements: boolean) => {
    startTransition(async () => {
      try {
        await updateChannelAction(ch.id, agentName, {
          receive_announcements: receiveAnnouncements,
        });
        toast.success(`Announcements ${receiveAnnouncements ? "on" : "off"}`);
        await refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to toggle announcements",
        );
      }
    });
  };

  const remove = (ch: AgentChannel) => {
    if (!confirm(`Unlink this ${ch.platform} channel?`)) return;
    startTransition(async () => {
      try {
        await deleteChannelAction(ch.id, agentName);
        toast.success("Channel unlinked");
        await refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete channel",
        );
      }
    });
  };

  return (
    <>
      <Section
        eyebrow="Channels"
        delay={delay}
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-3 w-3" />
            Link
          </Button>
        }
      >
        {channels.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className="h-4 w-4" />
            No linked channels.
          </div>
        ) : (
          <ul className="space-y-3">
            {channels.map((ch) => {
              const { primary, secondary } = channelLabel(ch);
              return (
                <li
                  key={ch.id}
                  className={`flex items-center gap-3 ${!ch.enabled ? "opacity-60" : ""}`}
                >
                  <PlatformMark platform={ch.platform} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-foreground truncate">
                      {primary}
                    </div>
                    <div className="text-xs text-muted-foreground truncate font-mono">
                      {secondary}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                      <span>on</span>
                      <Switch
                        checked={ch.enabled}
                        onCheckedChange={(v) => toggleEnabled(ch, v)}
                        disabled={pending}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                      <span>announce</span>
                      <Switch
                        checked={ch.receive_announcements}
                        onCheckedChange={(v) => toggleAnnounce(ch, v)}
                        disabled={pending}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => remove(ch)}
                      disabled={pending}
                      aria-label="Unlink channel"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
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
