/**
 * `edda channels ...` — link agents to external messaging platforms.
 *
 *   edda channels list [--agent <name>]
 *   edda channels link <agent> <platform> <external-id> [--announcements]
 *   edda channels unlink <id> [--force]
 *   edda channels toggle <id>
 */

import type { Command } from "commander";
import chalk from "chalk";
import * as p from "@clack/prompts";
import type { ChannelPlatform } from "@edda/db";
import { getDb } from "../lib/db.js";
import { runAction } from "../lib/run.js";
import { printTable, printJson, formatDate, formatId, wantsJson, type Column } from "../lib/output.js";

const VALID_PLATFORMS: ChannelPlatform[] = ["telegram", "discord", "slack"];

const CHANNEL_LIST_COLUMNS: Column[] = [
  { key: "id", header: "ID", width: 8, format: (v) => formatId(v) },
  { key: "agent_name", header: "Agent", width: 16 },
  { key: "platform", header: "Platform", width: 10 },
  { key: "external_id", header: "External ID", width: 30 },
  { key: "enabled", header: "Enabled", width: 8, format: (v) => (v ? "yes" : "no") },
  {
    key: "receive_announcements",
    header: "Announcements",
    width: 14,
    format: (v) => (v ? "yes" : "no"),
  },
  { key: "created_at", header: "Created", width: 10, format: formatDate },
];

export function registerChannelsCommands(program: Command) {
  const channels = program.command("channels").description("Manage agent channel links");

  // ── list ────────────────────────────────────────────────────────
  channels
    .command("list")
    .description("List channels across all agents (or one agent with --agent)")
    .option("-a, --agent <name>", "Filter to a single agent")
    .option("--json", "Output as JSON")
    .action(
      runAction(async (options: { agent?: string; json?: boolean }) => {
        const db = await getDb();

        let rows;
        if (options.agent) {
          const agent = await db.getAgentByName(options.agent);
          if (!agent) throw new Error(`Agent not found: ${options.agent}`);
          const list = await db.getChannelsByAgent(agent.id, { includeDisabled: true });
          rows = list.map((c) => ({ ...c, agent_name: agent.name }));
        } else {
          rows = await db.listAllChannels();
        }

        if (wantsJson(options, program)) {
          printJson(rows);
          return;
        }
        printTable(rows, CHANNEL_LIST_COLUMNS);
      }),
    );

  // ── link ────────────────────────────────────────────────────────
  channels
    .command("link <agent> <platform> <external-id>")
    .description("Link an agent to a platform channel (platform: telegram|discord|slack)")
    .option("--announcements", "Deliver scheduled-run announcements to this channel")
    .action(
      runAction(
        async (
          agentName: string,
          platform: string,
          externalId: string,
          options: { announcements?: boolean },
        ) => {
          if (!VALID_PLATFORMS.includes(platform as ChannelPlatform)) {
            throw new Error(
              `Invalid platform: ${platform}. Expected one of: ${VALID_PLATFORMS.join(", ")}`,
            );
          }

          const db = await getDb();
          const agent = await db.getAgentByName(agentName);
          if (!agent) throw new Error(`Agent not found: ${agentName}`);

          const existing = await db.getChannelByExternalId(
            platform as ChannelPlatform,
            externalId,
            { includeDisabled: true },
          );
          if (existing) {
            throw new Error(
              `Channel already exists (id ${existing.id}) for ${platform}:${externalId} — use \`edda channels unlink\` first or edit directly.`,
            );
          }

          const created = await db.createChannel({
            agent_id: agent.id,
            platform: platform as ChannelPlatform,
            external_id: externalId,
            receive_announcements: Boolean(options.announcements),
          });
          console.log(
            chalk.green(
              `✓ Linked ${agent.name} → ${platform}:${externalId} (channel ${formatId(created.id)})`,
            ),
          );
        },
      ),
    );

  // ── unlink ──────────────────────────────────────────────────────
  channels
    .command("unlink <id>")
    .description("Delete a channel link")
    .option("-f, --force", "Skip the confirmation prompt")
    .action(
      runAction(async (id: string, options: { force?: boolean }) => {
        const db = await getDb();
        // There's no getChannelById in @edda/db — look it up by scanning the
        // flat list. Small tables, fine.
        const all = await db.listAllChannels();
        const channel = all.find((c) => c.id === id);
        if (!channel) throw new Error(`Channel not found: ${id}`);

        if (!options.force) {
          const ok = await p.confirm({
            message: `Unlink ${channel.platform}:${channel.external_id} from "${channel.agent_name}"?`,
            initialValue: false,
          });
          if (p.isCancel(ok) || !ok) {
            p.cancel("Unlink cancelled");
            return;
          }
        }

        await db.deleteChannel(id);
        console.log(chalk.green(`✓ Unlinked`));
      }),
    );

  // ── toggle ──────────────────────────────────────────────────────
  channels
    .command("toggle <id>")
    .description("Enable or disable a channel link")
    .action(
      runAction(async (id: string) => {
        const db = await getDb();
        const all = await db.listAllChannels();
        const channel = all.find((c) => c.id === id);
        if (!channel) throw new Error(`Channel not found: ${id}`);

        const updated = await db.updateChannel(id, { enabled: !channel.enabled });
        console.log(
          chalk.green(
            `✓ ${updated.enabled ? "Enabled" : "Disabled"} ${channel.platform}:${channel.external_id}`,
          ),
        );
      }),
    );
}
