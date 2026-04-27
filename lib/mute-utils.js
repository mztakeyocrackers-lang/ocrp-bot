const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { sendUserNotification } = require('./notification-utils');

const MUTED_ROLE_ID = process.env.MUTED_ROLE_ID || '1465136661141782735';
const MUTE_STATE_FILE = path.join(__dirname, '..', 'data', 'mute-state.json');
const DEFAULT_POLL_MS = 30000;

function ensureStateDir() {
  fs.mkdirSync(path.dirname(MUTE_STATE_FILE), { recursive: true });
}

function loadState() {
  ensureStateDir();
  try {
    const raw = fs.readFileSync(MUTE_STATE_FILE, 'utf8');
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
  fs.writeFileSync(MUTE_STATE_FILE, JSON.stringify({
    entries: Array.isArray(state?.entries) ? state.entries : [],
  }, null, 2), 'utf8');
}

function upsertStateEntry(entry) {
  const state = loadState();
  state.entries = [
    ...state.entries.filter((item) => String(item.memberId) !== String(entry.memberId)),
    entry,
  ];
  saveState(state);
}

function removeStateEntry(memberId) {
  const state = loadState();
  state.entries = state.entries.filter((item) => String(item.memberId) !== String(memberId));
  saveState(state);
}

function parseDuration(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;

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

async function ensureBotCanManage(interaction, targetMember) {
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
  if (!permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'I need permission to manage roles to update mutes.';
  }

  const mutedRole = interaction.guild.roles.cache.get(MUTED_ROLE_ID)
    || await interaction.guild.roles.fetch(MUTED_ROLE_ID).catch(() => null);
  if (!mutedRole) {
    return 'The muted role is not configured correctly.';
  }

  if (me.roles.highest.comparePositionTo(mutedRole) <= 0) {
    return 'My role is not high enough to manage the muted role.';
  }

  if (!targetMember.manageable) {
    return 'I cannot update roles for that member because of role hierarchy.';
  }

  return null;
}

async function sendMuteNotice({ client, user, mutedBy, reason, expiresAtMs }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('You Have Been Muted')
    .setDescription(
      [
        `**Muted By:** <@${mutedBy.id}>`,
        `**Reason:** ${reason}`,
        `**Mute Ends:** ${formatTimestampFromMs(expiresAtMs)}`,
      ].join('\n'),
    )
    .setFooter({ text: 'SAVE Assistant Moderation' })
    .setTimestamp();

  return sendUserNotification({
    client,
    user,
    embeds: [embed],
    fallbackPrefix: 'Mute notice DM delivery failed. Posting the mute notice here instead.',
  });
}

async function sendUnmuteNotice({ client, user, unmutedBy, reason, automatic = false }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(automatic ? 'Your Mute Expired' : 'You Have Been Unmuted')
    .setDescription(
      [
        `**Updated By:** ${automatic ? 'Automatic mute timer' : `<@${unmutedBy.id}>`}`,
        `**Reason:** ${reason}`,
      ].join('\n'),
    )
    .setFooter({ text: 'SAVE Assistant Moderation' })
    .setTimestamp();

  return sendUserNotification({
    client,
    user,
    embeds: [embed],
    fallbackPrefix: 'Unmute notice DM delivery failed. Posting the unmute notice here instead.',
  });
}

async function startMute({ interaction, targetMember, reason, durationInput }) {
  const durationMs = parseDuration(durationInput);
  if (!durationMs) {
    throw new Error('Use a valid mute duration like `30m`, `2h`, `1d`, or `1d 12h`.');
  }

  if (targetMember.roles.cache.has(MUTED_ROLE_ID)) {
    throw new Error('That member is already muted.');
  }

  const expiresAtMs = Date.now() + durationMs;
  await targetMember.roles.add(MUTED_ROLE_ID, `Muted by ${interaction.user.tag}: ${reason}`);

  upsertStateEntry({
    memberId: targetMember.id,
    guildId: interaction.guildId,
    reason,
    durationInput,
    expiresAtMs,
    mutedById: interaction.user.id,
    mutedByTag: interaction.user.tag,
  });

  const notice = await sendMuteNotice({
    client: interaction.client,
    user: targetMember.user,
    mutedBy: interaction.user,
    reason,
    expiresAtMs,
  }).catch(() => ({ deliveredVia: 'failed' }));

  return { expiresAtMs, delivery: notice.deliveredVia || 'failed' };
}

async function endMute({ client, guild, targetMember, reason, unmutedBy = null, automatic = false }) {
  if (targetMember.roles.cache.has(MUTED_ROLE_ID)) {
    await targetMember.roles.remove(MUTED_ROLE_ID, automatic ? 'Mute expired automatically' : `Unmuted by ${unmutedBy?.tag || 'system'}: ${reason}`);
  }

  removeStateEntry(targetMember.id);

  const notice = await sendUnmuteNotice({
    client,
    user: targetMember.user,
    unmutedBy,
    reason,
    automatic,
  }).catch(() => ({ deliveredVia: 'failed' }));

  return { delivery: notice.deliveredVia || 'failed' };
}

function createMuteNotifier({ client, pollMs = DEFAULT_POLL_MS }) {
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
          const member = await guild.members.fetch(String(entry.memberId));
          await endMute({
            client,
            guild,
            targetMember: member,
            reason: entry.reason || 'Mute duration completed.',
            unmutedBy: null,
            automatic: true,
          });
        } catch (error) {
          console.error('Automatic unmute failed:', error);
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
  MUTED_ROLE_ID,
  createMuteNotifier,
  endMute,
  ensureBotCanManage,
  startMute,
  formatTimestampFromMs,
};
