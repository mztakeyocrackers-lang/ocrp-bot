const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { sendUserNotification } = require('./notification-utils');

const BAN_STATE_FILE = path.join(__dirname, '..', 'data', 'ban-state.json');
const DEFAULT_POLL_MS = 30000;

function ensureStateDir() {
  fs.mkdirSync(path.dirname(BAN_STATE_FILE), { recursive: true });
}

function loadState() {
  ensureStateDir();
  try {
    const raw = fs.readFileSync(BAN_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(BAN_STATE_FILE, JSON.stringify({
    entries: Array.isArray(state?.entries) ? state.entries : [],
  }, null, 2), 'utf8');
}

function upsertStateEntry(entry) {
  const state = loadState();
  state.entries = [
    ...state.entries.filter((item) => !(
      String(item.guildId) === String(entry.guildId)
      && String(item.userId) === String(entry.userId)
    )),
    entry,
  ];
  saveState(state);
}

function removeStateEntry(guildId, userId) {
  const state = loadState();
  state.entries = state.entries.filter((item) => !(
    String(item.guildId) === String(guildId)
    && String(item.userId) === String(userId)
  ));
  saveState(state);
}

function parseDuration(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  if (['perm', 'permanent', 'forever'].includes(raw)) return 0;

  let totalMs = 0;
  const matches = [...raw.matchAll(/(\d+)\s*(d|h|m)/g)];
  if (!matches.length) return null;

  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (unit === 'd') totalMs += amount * 24 * 60 * 60 * 1000;
    if (unit === 'h') totalMs += amount * 60 * 60 * 1000;
    if (unit === 'm') totalMs += amount * 60 * 1000;
  }

  return totalMs > 0 ? totalMs : null;
}

function formatTimestampFromMs(value) {
  const unix = Math.floor(Number(value) / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return 'Unknown';
  return `<t:${unix}:F> - <t:${unix}:R>`;
}

async function ensureBotCanKick(interaction, targetMember) {
  if (!interaction.inGuild() || !interaction.channel || !interaction.channel.isTextBased()) {
    return 'This command can only be used in a server text channel.';
  }

  const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe().catch(() => null));
  if (!me) {
    return 'I could not verify my server permissions.';
  }

  const permissions = interaction.channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return 'I need permission to view this channel.';
  }
  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    return 'I need permission to send messages in this channel.';
  }
  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    return 'I need permission to embed links in this channel.';
  }
  if (!permissions.has(PermissionFlagsBits.KickMembers)) {
    return 'I need the `Kick Members` permission to use this command.';
  }
  if (!targetMember.kickable) {
    return 'I cannot kick that member because of role hierarchy or server permissions.';
  }

  return null;
}

async function ensureBotCanBan(interaction, targetMember = null) {
  if (!interaction.inGuild() || !interaction.channel || !interaction.channel.isTextBased()) {
    return 'This command can only be used in a server text channel.';
  }

  const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe().catch(() => null));
  if (!me) {
    return 'I could not verify my server permissions.';
  }

  const permissions = interaction.channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return 'I need permission to view this channel.';
  }
  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    return 'I need permission to send messages in this channel.';
  }
  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    return 'I need permission to embed links in this channel.';
  }
  if (!permissions.has(PermissionFlagsBits.BanMembers)) {
    return 'I need the `Ban Members` permission to use this command.';
  }
  if (targetMember && !targetMember.bannable) {
    return 'I cannot ban that member because of role hierarchy or server permissions.';
  }

  return null;
}

async function sendKickNotice({ client, user, kickedBy, reason }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('You Have Been Kicked')
    .setDescription(
      [
        `**Kicked By:** <@${kickedBy.id}>`,
        `**Reason:** ${reason}`,
      ].join('\n'),
    )
    .setFooter({ text: 'SAVE Assistant Moderation' })
    .setTimestamp();

  return sendUserNotification({
    client,
    user,
    embeds: [embed],
    fallbackPrefix: 'Kick notice DM delivery failed. Posting the kick notice here instead.',
  });
}

async function sendBanNotice({ client, user, bannedBy, reason, expiresAtMs = null }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('You Have Been Banned')
    .setDescription(
      [
        `**Banned By:** <@${bannedBy.id}>`,
        `**Reason:** ${reason}`,
        `**Ban Length:** ${expiresAtMs ? formatTimestampFromMs(expiresAtMs) : 'Permanent'}`,
      ].join('\n'),
    )
    .setFooter({ text: 'SAVE Assistant Moderation' })
    .setTimestamp();

  return sendUserNotification({
    client,
    user,
    embeds: [embed],
    fallbackPrefix: 'Ban notice DM delivery failed. Posting the ban notice here instead.',
  });
}

async function sendUnbanNotice({ client, user, reason, automatic = false }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(automatic ? 'Your Temporary Ban Expired' : 'You Have Been Unbanned')
    .setDescription(
      [
        `**Updated By:** ${automatic ? 'Automatic ban timer' : 'SAVE Assistant'}`,
        `**Reason:** ${reason}`,
      ].join('\n'),
    )
    .setFooter({ text: 'SAVE Assistant Moderation' })
    .setTimestamp();

  return sendUserNotification({
    client,
    user,
    embeds: [embed],
    fallbackPrefix: 'Unban notice DM delivery failed. Posting the unban notice here instead.',
  });
}

async function startKick({ interaction, targetMember, reason }) {
  await targetMember.kick(`Kicked by ${interaction.user.tag}: ${reason}`);

  const notice = await sendKickNotice({
    client: interaction.client,
    user: targetMember.user,
    kickedBy: interaction.user,
    reason,
  }).catch(() => ({ deliveredVia: 'failed' }));

  return {
    delivery: notice.deliveredVia || 'failed',
  };
}

async function startBan({ interaction, targetUser, targetMember = null, reason, durationInput = '' }) {
  const trimmedDuration = String(durationInput || '').trim();
  const durationMs = trimmedDuration ? parseDuration(trimmedDuration) : null;

  if (trimmedDuration && durationMs === null) {
    throw new Error('Use a valid ban duration like `30m`, `2h`, `1d`, `7d`, or `perm`.');
  }

  const existingBan = await interaction.guild.bans.fetch(targetUser.id).catch(() => null);
  if (existingBan) {
    throw new Error('That user is already banned.');
  }

  const expiresAtMs = durationMs > 0 ? Date.now() + durationMs : null;

  await interaction.guild.bans.create(targetUser.id, {
    reason: `Banned by ${interaction.user.tag}: ${reason}`,
  });

  if (expiresAtMs) {
    upsertStateEntry({
      guildId: interaction.guildId,
      userId: targetUser.id,
      reason,
      durationInput: trimmedDuration,
      expiresAtMs,
      bannedById: interaction.user.id,
      bannedByTag: interaction.user.tag,
    });
  }

  const notice = await sendBanNotice({
    client: interaction.client,
    user: targetUser,
    bannedBy: interaction.user,
    reason,
    expiresAtMs,
  }).catch(() => ({ deliveredVia: 'failed' }));

  return {
    expiresAtMs,
    permanent: !expiresAtMs,
    delivery: notice.deliveredVia || 'failed',
  };
}

async function endBan({ client, guild, userId, reason, automatic = false }) {
  try {
    await guild.bans.remove(String(userId), automatic ? 'Temporary ban expired automatically' : reason);
  } catch (error) {
    const code = Number(error?.code);
    if (code !== 10026) {
      throw error;
    }
  }

  removeStateEntry(guild.id, userId);

  const user = await client.users.fetch(String(userId)).catch(() => null);
  if (!user) {
    return { delivery: 'failed' };
  }

  const notice = await sendUnbanNotice({
    client,
    user,
    reason,
    automatic,
  }).catch(() => ({ deliveredVia: 'failed' }));

  return { delivery: notice.deliveredVia || 'failed' };
}

function createBanNotifier({ client, pollMs = DEFAULT_POLL_MS }) {
  let timer = null;
  let active = false;

  async function tick() {
    if (active) return;
    active = true;
    try {
      const state = loadState();
      const expired = state.entries.filter((entry) => Number(entry.expiresAtMs) > 0 && Date.now() >= Number(entry.expiresAtMs));

      for (const entry of expired) {
        try {
          const guild = await client.guilds.fetch(String(entry.guildId));
          await endBan({
            client,
            guild,
            userId: entry.userId,
            reason: entry.reason || 'Temporary ban duration completed.',
            automatic: true,
          });
        } catch (error) {
          console.error('Automatic unban failed:', error);
        }
      }
    } finally {
      active = false;
    }
  }

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, Math.max(15000, Number(pollMs) || DEFAULT_POLL_MS));
    },
  };
}

module.exports = {
  createBanNotifier,
  ensureBotCanBan,
  ensureBotCanKick,
  formatTimestampFromMs,
  startBan,
  startKick,
};
