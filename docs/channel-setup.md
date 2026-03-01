# Channel Setup Guide

Edda supports three messaging platforms as channel integrations. Each is optional — set the required environment variables to enable.

All channels share the same architecture:
- **Inbound:** Messages are routed to the linked agent via `handleInboundMessage()`
- **Outbound:** Agent responses stream back with progressive message edits
- **Access control:** Users must be approved via the `paired_users` table before interacting
- **Linking:** Slash commands (`/link`, `/unlink`, `/status`) manage which agent serves a channel

---

## Telegram

**Connection type:** Webhook (HTTP POST from Telegram servers)

### Prerequisites

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. If using forum groups, disable Group Privacy: @BotFather → /mybots → Bot Settings → Group Privacy → Turn off
3. Generate an internal API secret: `openssl rand -hex 32`

### Environment Variables

```bash
TELEGRAM_BOT_TOKEN=<token from @BotFather>
INTERNAL_API_SECRET=<your generated secret>

# Optional — defaults to http://localhost:8000/api/channels/telegram/webhook
TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/channels/telegram/webhook
```

`INTERNAL_API_SECRET` is **required** when `TELEGRAM_BOT_TOKEN` is set. It authenticates both internal API calls and the Telegram webhook via `X-Telegram-Bot-Api-Secret-Token`.

### How It Works

- On startup, Edda registers the webhook URL with Telegram's API
- Incoming updates hit `/api/channels/telegram/webhook` on the health server
- The webhook secret is validated with timing-safe comparison
- Forum topics use `{chatId}:{threadId}` as the external ID; DMs use `{chatId}:dm`
- DMs without a linked channel route to the default agent

### Bot Commands

| Command | Description |
|---|---|
| `/start` | Show help and available commands |
| `/link <agent>` | Link this topic/DM to an agent |
| `/unlink` | Remove the agent link |
| `/status` | Show linked agent and recent activity |

### Features

- Streaming with progressive message edits
- Typing indicator (`sendChatAction`)
- Forum topic support (`message_thread_id`)
- Webhook registration on startup

---

## Discord

**Connection type:** Gateway WebSocket (persistent connection, no public URL required)

### Prerequisites

1. Create an application at [discord.com/developers](https://discord.com/developers/applications)
2. Add a Bot under the application
3. Enable the **Message Content** privileged intent (Bot → Privileged Gateway Intents)
4. Generate an invite URL with these scopes and permissions:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`
5. Invite the bot to your server using the generated URL

### Environment Variables

```bash
DISCORD_BOT_TOKEN=<token from Discord Developer Portal>
```

No other variables required. The bot connects via WebSocket — no webhook URL needed.

### How It Works

- On startup, the bot logs in and registers the `/edda` slash command globally
- Listens for `messageCreate` and `interactionCreate` events via the Gateway
- Guild channels use `{guildId}:{channelId}` as the external ID; DMs use `dm:{channelId}`
- DMs without a linked channel route to the default agent
- Uses discord.js channel cache to minimize API calls during streaming

### Slash Commands

| Command | Description |
|---|---|
| `/edda link agent:<name>` | Link this channel to an agent |
| `/edda unlink` | Remove the agent link |
| `/edda status` | Show linked agent and recent activity |

Error and status responses are ephemeral (only visible to the command user).

### Features

- Streaming with progressive message edits (single REST call per edit)
- Typing indicator (`sendTyping`)
- "Message not modified" error suppression during streaming
- Channel cache for efficient outbound delivery
- Global slash command registration

### Required Intents

| Intent | Why |
|---|---|
| `Guilds` | Channel and guild metadata |
| `GuildMessages` | Receive messages in server channels |
| `MessageContent` | Read message text (privileged — must enable in portal) |
| `DirectMessages` | Receive DM messages |

---

## Slack

**Connection type:** Socket Mode (WebSocket via Slack infrastructure, no public URL required)

### Prerequisites

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** (Settings → Socket Mode → Enable)
3. Generate an **App-Level Token** with `connections:write` scope (Settings → Basic Information → App-Level Tokens)
4. Add a **Bot Token** with these scopes (OAuth & Permissions → Bot Token Scopes):
   - `chat:write` — Send messages
   - `chat:write.public` — Send to channels the bot isn't in
   - `commands` — Slash commands
   - `im:history` — Read DM messages
   - `channels:history` — Read channel messages
   - `groups:history` — Read private channel messages
5. Create the `/edda` slash command (Slash Commands → Create New Command)
   - Command: `/edda`
   - Description: `Manage Edda agent connections`
   - Usage hint: `link <agent> | unlink | status`
6. Subscribe to bot events (Event Subscriptions → Subscribe to Bot Events):
   - `message.channels`
   - `message.groups`
   - `message.im`
7. Install the app to your workspace

### Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-...   # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...    # App-Level Token (Socket Mode)
```

Both are **required**. If only one is set, Edda logs a warning and skips Slack initialization.

### How It Works

- On startup, the app connects via Socket Mode (no public endpoint needed)
- Listens for `message` events and `/edda` slash commands
- Channel external IDs use `{teamId}:{channelId}` format
- DMs (channel IDs starting with `D`) without a linked channel route to the default agent
- No typing indicator available for Slack bots

### Slash Commands

| Command | Description |
|---|---|
| `/edda link <agent>` | Link this channel to an agent |
| `/edda unlink` | Remove the agent link |
| `/edda status` | Show linked agent and recent activity |

Error and status responses are ephemeral. Link/unlink confirmations are visible to the channel.

### Features

- Streaming with progressive message edits (`chat.update`)
- Ephemeral slash command responses
- Socket Mode (no public URL or webhook setup required)

---

## Access Control (All Platforms)

All three platforms share a common user pairing system. Before any user can interact with an agent, they must be approved.

### Flow

1. **New user sends a message** → Edda creates a `pending` row in the `paired_users` table and replies with "Access requested — waiting for approval"
2. **Admin approves** → Via the web UI dashboard (Pending Confirmations) or directly in the database
3. **User sends another message** → Now routed to the linked agent normally

### Statuses

| Status | Behavior |
|---|---|
| No row | First message creates a `pending` request |
| `pending` | Messages are blocked; user sees "waiting for approval" |
| `approved` | Messages are routed to agents normally |
| `rejected` | Messages are silently dropped (logged server-side) |

### Approving Users

Pending pairing requests appear in the web UI dashboard under **Pending Confirmations**. The count includes requests from all platforms. Approve or reject from the confirmations interface.

---

## Linking Channels to Agents

After access is approved, use slash commands to link a channel/topic to a specific agent:

```
/link my-agent       # Telegram
/edda link my-agent  # Discord or Slack
```

- Each channel can be linked to exactly one agent
- Use `/unlink` (or `/edda unlink`) to change the linked agent
- DMs without a link automatically route to the `default_agent` from settings
- Use `/status` (or `/edda status`) to see the linked agent, thread config, and recent runs

---

## Announcements

Agents can broadcast to linked channels when scheduled runs complete.

1. Link a channel to an agent (via slash command or web UI)
2. Enable `receive_announcements` on the channel (via web UI or `manage_channel` tool)
3. When the agent's cron schedule completes, the last assistant message is delivered to all announcement channels

---

## Troubleshooting

### Telegram

| Issue | Fix |
|---|---|
| Webhook returns 403 | `INTERNAL_API_SECRET` not set or doesn't match |
| Bot doesn't respond in groups | Disable Group Privacy via @BotFather |
| "Telegram adapter not initialized" | Check `TELEGRAM_BOT_TOKEN` is set correctly |

### Discord

| Issue | Fix |
|---|---|
| Bot doesn't receive messages | Enable **Message Content** intent in Developer Portal |
| Slash commands not showing | Wait ~1 hour for global registration, or check bot permissions |
| "Discord channel not found" | Ensure bot is invited to the server with correct permissions |

### Slack

| Issue | Fix |
|---|---|
| "Both tokens required" warning | Set both `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` |
| Bot doesn't respond | Check Socket Mode is enabled and event subscriptions are configured |
| `/edda` command not found | Create the slash command in app settings |
| Bot can't post to channel | Add `chat:write` and `chat:write.public` scopes |

### All Platforms

| Issue | Fix |
|---|---|
| "Access requested" loop | Approve the user in the web UI (Dashboard → Pending Confirmations) |
| "This channel isn't linked" | Run the link command to connect a channel to an agent |
| "Agent is currently unavailable" | The linked agent is disabled — enable it or link to a different agent |
