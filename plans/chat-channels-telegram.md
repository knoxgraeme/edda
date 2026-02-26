# Chat Channels — Multi-Platform Agent Routing (Telegram First)

## Problem

Edda's interactive chat is web-only. Users can only talk to agents through the Next.js UI (`/api/stream` SSE endpoint). There's no way to message an agent from Telegram, Slack, or any other chat platform. Background agents can notify the inbox, but there's no bidirectional conversation channel outside the browser.

## Key Discoveries

1. **No LangChain/LangGraph Telegram packages exist.** The integration is a thin adapter — receive messages, invoke `buildAgent(agent).invoke()`, send responses back. LangGraph intentionally leaves transport to the consumer.

2. **grammY** is the best Node.js Telegram library for this project — TypeScript-first, native forum topic support, active maintenance (v1.40+, ~1.2M npm downloads/week), clean webhook integration.

3. **Telegram forum topics** map cleanly to agents. A supergroup with forum mode gives each agent its own topic (`message_thread_id`), with DMs falling back to the default agent.

4. **The agent invocation path is already platform-agnostic.** Both the web UI (`handleStream`) and cron runner (`local.ts`) call `buildAgent(agent).invoke()` with the same pattern. A Telegram handler follows the same path.

5. **The notification system (migration 002) already triggers agent runs.** `notify()` with `agent:<name>:active` calls `triggerAgentRun()` which invokes the agent on the backend. Channel delivery hooks into this existing completion path.

6. **OpenClaw's gateway pattern** confirms the architecture: bindings are primarily inbound routing, proactive delivery goes to explicitly configured targets — not a broadcast to all linked channels. OpenClaw supports both "main-session" processing (agent receives and processes background output) and "announce" mode (direct pass-through to channel, bypassing agent).

## Design

### Two Inbound Paths, Two Delivery Modes

There are two ways an agent gets invoked — user-initiated chat and notification-triggered runs. For proactive delivery, there are two modes depending on whether the target agent should process the content or just relay it.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Interactive Chat                                                    │
│                                                                     │
│  User sends message (web, Telegram, Slack, etc.)                    │
│    → buildAgent().invoke()                                          │
│    → response goes back the way it came                             │
│                                                                     │
│  Web UI    ──→ /api/stream ──→ invoke ──→ SSE response             │
│  Telegram  ──→ webhook     ──→ invoke ──→ reply in same topic      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Notification Delivery Modes                                         │
│                                                                     │
│  'agent:edda:active'  — Agent processes the notification             │
│    → triggerAgentRun('edda')                                        │
│    → edda invokes, processes content, produces response             │
│    → response delivered to edda's channels (receive_announcements)  │
│    → edda has full context for follow-up conversation               │
│                                                                     │
│  'announce:edda'  — Pass-through, no agent processing               │
│    → look up edda's channels (receive_announcements = true)         │
│    → push source agent's output directly to those channels          │
│    → edda is NOT invoked — zero cost, instant delivery              │
│    → edda has no context if user follows up (but can look it up)    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Notification targets:                                               │
│    'inbox'               → notification row in web UI               │
│    'agent:<name>'        → passive (agent reads on next run)        │
│    'agent:<name>:active' → agent processes + delivers to channels   │
│    'announce:<name>'     → pass-through to agent's channels (NEW)   │
└─────────────────────────────────────────────────────────────────────┘
```

**When to use which:**

| | `agent:edda:active` | `announce:edda` |
|---|---|---|
| Edda invoked? | Yes | No |
| Edda has context of what was sent? | Yes (in thread history) | No |
| Cost | LLM call | Zero |
| Latency | 10-60s | Instant |
| User can follow up with full context? | Yes | Partially (edda can look it up via tools) |
| Good for | Digest summaries, batched notifications | Status updates, simple pass-through |

### Agent Channels Table (Platform-Agnostic)

One table that all current and future integrations share:

```sql
CREATE TABLE agent_channels (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id                UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  platform                TEXT NOT NULL,
  external_id             TEXT NOT NULL,
  config                  JSONB NOT NULL DEFAULT '{}',
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  receive_announcements   BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE INDEX idx_agent_channels_agent ON agent_channels(agent_id);
CREATE INDEX idx_agent_channels_lookup ON agent_channels(platform, external_id) WHERE enabled;
```

- `enabled` — channel accepts interactive chat (user message → agent invoke → reply)
- `receive_announcements` — channel receives proactive output from `agent:active` and `announce` notification targets

Inbound chat always works on enabled channels. Announcements only go to channels with `receive_announcements = true`. This prevents noisy fan-out when an agent is linked to many channels.

Platform-specific conventions for `external_id` and `config`:

| Platform  | `external_id`              | `config` example                          |
|-----------|----------------------------|-------------------------------------------|
| Telegram  | `{chat_id}:{thread_id}`   | `{ "topic_name": "edda" }`               |
| Slack     | `{workspace}:{channel}`   | `{ "channel_name": "#edda-digest" }`     |
| Discord   | `{guild}:{channel}`       | `{ "channel_name": "edda" }`             |

The routing query is always the same regardless of platform:

```typescript
const channel = await getChannelByExternalId("telegram", `${chatId}:${threadId}`);
const agent = await getAgentById(channel.agent_id);
```

### Thread ID Strategy

Thread scoping is controlled by `metadata.thread_scope` on the agent (agent-level config, following the existing pattern of `metadata.stores` and `metadata.filesystem`):

| `thread_scope` | Behavior |
|---|---|
| `shared` (default) | All platforms share one thread. One conversation everywhere. |
| `per_channel` | Each channel link gets its own thread. Telegram and WhatsApp are separate. |

Inspired by OpenClaw's `session.dmScope`, which is also set per-agent. A personal assistant (edda) wants `shared` — it shouldn't matter which device you're on. A multi-user or domain-specific agent might want `per_channel`.

`thread_scope` is a simple enum — belongs as a column, not in `metadata`. `metadata` is for complex nested structures (`stores`, `filesystem`). Simple queryable values with CHECK constraints and clear defaults belong as columns.

```sql
-- In the agent_channels migration (or a separate agents migration)
ALTER TABLE agents ADD COLUMN thread_scope TEXT NOT NULL DEFAULT 'shared'
  CHECK (thread_scope IN ('shared', 'per_channel'));
```

Thread ID resolution based on `thread_lifetime` × `thread_scope`:

| Context Mode | `shared` | `per_channel` |
|---|---|---|
| `ephemeral` | `task-{agent}-{uuid}` | `task-{agent}-{uuid}` |
| `daily` | `task-{agent}-{date}` | `task-{agent}-{date}-{platform}:{external_id}` |
| `persistent` | `task-{agent}` | `task-{agent}-{platform}:{external_id}` |

- `ephemeral` always gets a fresh UUID regardless of scope — no continuity by definition.
- `shared` + `persistent` = one thread for everything (web, Telegram, WhatsApp, cron). The agent sees the full conversation across all platforms.
- `per_channel` + `persistent` = separate threads per channel link. Each platform has its own conversation context.

The existing `resolveThreadId()` in `build-agent.ts:349` expands to accept an optional channel parameter:

```typescript
export function resolveThreadId(
  agent: Agent,
  channel?: { platform: string; external_id: string },
): string {
  const channelSuffix =
    agent.thread_scope === "per_channel" && channel
      ? `-${channel.platform}:${channel.external_id}`
      : "";

  const today = new Date().toISOString().split("T")[0];
  switch (agent.thread_lifetime) {
    case "ephemeral":
      return `task-${agent.name}-${randomUUID()}`;
    case "daily":
      return `task-${agent.name}-${today}${channelSuffix}`;
    case "persistent":
      return `task-${agent.name}${channelSuffix}`;
  }
}
```

**Web UI note:** The web "new chat" button creates an ad-hoc thread (UUID) regardless of scope — it's a one-off, not the persistent thread. The web UI could also offer "resume conversation" to re-open the primary persistent thread (`task-{agent}`).

### Channel Delivery on Triggered Runs

Two paths, same delivery mechanism:

**`agent:<name>:active` — agent processes, then delivers:**

```typescript
// In triggerAgentRun(), after agent.invoke() completes:
const response = extractLastMessage(result);
await completeTaskRun(run.id, { output_summary: response, ... });

// Deliver agent's response to announcement channels
const channels = await getChannelsByAgent(definition.id, { receiveAnnouncements: true });
for (const channel of channels) {
  await deliverToChannel(channel, response);
}
```

**`announce:<name>` — pass-through, no agent invocation:**

```typescript
// In notify(), when target is 'announce:<name>':
const agent = await getAgentByName(name);
const channels = await getChannelsByAgent(agent.id, { receiveAnnouncements: true });
for (const channel of channels) {
  await deliverToChannel(channel, params.summary);  // source output, unprocessed
}
```

### Why This Doesn't Leak Web Chat to Telegram

Channel delivery is structurally isolated to system-initiated runs. The invocation paths never cross:

| Path | Creates task_run? | Trigger | Channel delivery? |
|---|---|---|---|
| Web UI chat (`handleStream`) | No | n/a | No — never enters delivery code |
| Telegram chat (grammY webhook) | No | n/a | No — response goes via `ctx.reply()` |
| Cron runner (`local.ts`) | Yes | `cron` | Yes — `receive_announcements` channels |
| Notification trigger (`triggerAgentRun`) | Yes | `notification` | Yes — `receive_announcements` channels |
| Announce pass-through | No | n/a | Yes — but only the source output, not a chat response |

The delivery hook lives exclusively inside `triggerAgentRun()`, the cron runner, and the new `announce` path — never in interactive chat handlers.

The `trigger` field check is a safety guard for the future — if we later add `task_run` tracking to interactive chat (for observability), runs with `trigger = "user"` would be explicitly excluded from channel delivery.

### Telegram Message Flow

```
Telegram webhook POST → /api/telegram/webhook
    │
    ▼
grammY middleware (bot.on("message:text"))
    │
    ▼
Extract chat_id + message_thread_id
    │
    ▼
getChannelByExternalId("telegram", `${chat_id}:${thread_id}`)
    │  (fallback: DMs → default_agent from settings)
    ▼
buildAgent(agent).invoke({
  messages: [new HumanMessage(text)],
}, {
  configurable: {
    thread_id: resolveChannelThreadId(agent, platform, externalId),
    agent_name: agent.name,
    retrieval_context: resolveRetrievalContext(agent.metadata, agent.name),
  },
})
    │
    ▼
ctx.reply(extractLastMessage(result), { message_thread_id })
```

### Long-Running Response Handling

Agent invocations take 10-60s. Telegram typing indicators last 5s:

```typescript
const typingInterval = setInterval(() => {
  ctx.api.sendChatAction(chatId, "typing", { message_thread_id });
}, 4000);

try {
  await ctx.replyWithChatAction("typing");
  const result = await invokeAgent(/* ... */);
  await ctx.reply(formatResponse(result), { message_thread_id });
} finally {
  clearInterval(typingInterval);
}
```

Full response is sent on completion (not streamed via `editMessageText`). Streaming edits are rate-limited by Telegram (~30/min/chat) and add complexity for marginal UX gain.

### Configuration

New optional env vars in `apps/server/src/config.ts`:

```typescript
// Telegram (optional — omit to disable)
TELEGRAM_BOT_TOKEN: z.string().optional(),
TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
```

The webhook URL and chat/topic mappings live in the `agent_channels` table, not env vars.

## Implementation Phases

### Phase 1: Database Foundation

**Migration + DB queries for `agent_channels` table and `thread_scope` column on agents.**

Files:
- `packages/db/migrations/009_agent_channels.sql` — `agent_channels` table + `ALTER TABLE agents ADD COLUMN thread_scope`
- `packages/db/src/channels.ts` — CRUD: `createChannel`, `getChannelByExternalId`, `getChannelsByAgent`, `getChannelsByPlatform`, `updateChannel`, `deleteChannel`
- `packages/db/src/types.ts` — `AgentChannel` type, `ChannelPlatform` union type, `ThreadScope` union type, add `thread_scope` to `Agent` interface
- `packages/db/src/index.ts` — Re-export channel queries

### Phase 2: Telegram Chat Adapter + Channel Delivery

**Core bidirectional chat via grammY, plus both announcement delivery modes.**

Files:
- `apps/server/src/channels/telegram.ts` — grammY bot setup, webhook handler, message routing, response formatting, typing indicator, Markdown conversion. Exports `sendToTelegram(externalId, text)` for announcement delivery.
- `apps/server/src/channels/deliver.ts` — Platform-agnostic `deliverToChannel(channel, text)` dispatcher. Given an `AgentChannel` row, calls the right platform's send function.
- `apps/server/src/channels/types.ts` — Shared types used by all adapters
- `apps/server/src/server/index.ts` — Mount `/api/telegram/webhook` route
- `apps/server/src/config.ts` — Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` to optional env schema
- `apps/server/src/utils/notify.ts` — Two additions:
  - After `triggerAgentRun()` completes (`agent:active`), deliver response to `receive_announcements` channels
  - New `announce:<name>` target parsing: look up agent's channels, push source output directly

Interactive chat behavior:
- On message: look up `agent_channels` → invoke agent → reply in same topic
- DMs to bot (no `message_thread_id`): route to `default_agent`
- Unrecognized topic: reply with "This topic isn't linked to an agent"
- Errors: reply with a generic error message, log details server-side

Announcement delivery behavior:
- `agent:edda:active` → edda runs, processes, produces response → delivered to `receive_announcements` channels
- `announce:edda` → source output pushed directly to edda's `receive_announcements` channels (no agent invocation)

### Phase 3: Admin UI

**Web UI to manage channel links.**

Files:
- `apps/web/src/app/agents/[name]/agent-detail-client.tsx` — Add "Channels" tab showing linked channels with add/remove, toggle `receive_announcements`
- `apps/web/src/app/api/v1/channels/route.ts` — REST endpoints for channel CRUD
- `apps/web/src/app/actions.ts` — Server actions: `createChannelAction`, `deleteChannelAction`, `updateChannelAction`

### Phase 4: Setup Helpers

**Convenience for initial Telegram setup.**

- Bot `/start` command handler — replies with setup instructions
- `/link <agent_name>` command in a topic — creates the `agent_channels` row (admin-only, validated against `agents` table)
- `/unlink` command — removes the channel link
- `/status` command — shows which agent is linked, context mode, recent runs

## What This Plan Does NOT Include

- **Slack/Discord adapters** — Same pattern, different transport. Built when needed.
- **Generic ChatAdapter interface** — Platform differences (auth, message formats, embeds, reactions) are too varied. Each adapter is its own file following the same pattern.
- **Message queue** — Agent invocations are synchronous. No queue needed.
- **Streaming responses** — Wait-and-send is simpler and sufficient. Can be revisited.
- **Web UI changes to use agent_channels** — The web UI already works via `/api/stream`. No benefit to forcing it through the channel abstraction.
- **Media/file handling** — Text-only initially. Image/file support is a follow-up.

## Dependencies

- `grammy` — npm package, TypeScript Telegram Bot framework
- Existing: `buildAgent()`, `resolveThreadId()`, `notify()`, `createTaskRun()` lifecycle, `runWithConcurrencyLimit()`

## Open Questions

1. **Multi-bot vs single-bot** — One bot token with topic routing (recommended) vs separate bot per agent (complex, unnecessary initially)?
2. **Rate limiting** — Should we throttle inbound messages per user/chat to prevent abuse? Telegram's own limits may suffice initially.
3. **Message length** — Telegram has a 4096-char limit per message. Should we split long agent responses or truncate?
4. **Webhook registration** — Auto-register webhook on server start via `bot.api.setWebhook()`, or manual setup via BotFather?
