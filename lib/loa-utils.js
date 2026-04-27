const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { updatePersonnelStatusByDiscordId } = require('./tracker-log');

const LOA_ROLE_ID = process.env.LOA_ROLE_ID || '1497050446689468536';
const LOA_LOG_CHANNEL_ID = process.env.LOA_LOG_CHANNEL_ID || '1465136666523209753';
const LOA_ALERT_ROLE_ID = process.env.LOA_ALERT_ROLE_ID || '1465136661187924105';
const LOA_STATE_FILE = path.join(__dirname, '..', 'data', 'loa-state.json');
const DEFAULT_POLL_MS = 30000;

function ensureStateDir() {
  fs.mkdirSync(path.dirname(LOA_STATE_FILE), { recursive: true });
}

function loadState() {
  ensureStateDir();

  try {
    const raw = fs.readFileSync(LOA_STATE_FILE, 'utf8');
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
  fs.writeFileSync(LOA_STATE_FILE, JSON.stringify({
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
  const nextEntries = state.entries.filter((item) => String(item.memberId) !== String(memberId));
  state.entries = nextEntries;
  saveState(state);
}

function getStateEntry(memberId) {
  return loadState().entries.find((item) => String(item.memberId) === String(memberId)) || null;
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

  if (totalMs <= 0) return null;
  return totalMs;
}

function formatDurationLabel(input) {
  return String(input || '').trim() || 'Unknown';
}

function formatTimestampFromMs(value) {
  const unix = Math.floor(Number(value) / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return 'Unknown';
  return `<t:${unix}:F> - <t:${unix}:R>`;
}

async function fetchMember(interaction, user) {
  return interaction.options.getMember('member')
    || await interaction.guild.members.fetch(user.id).catch(() => null);
}

async function validateRoleAccess(channel, me) {
  if (!channel || !channel.isTextBased()) {
    return 'I can only use this command in a text channel.';
  }

  if (!me) {
    return 'I could not verify my server permissions.';
  }

  const permissions = channel.permissionsFor(me);
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
    return 'I need permission to manage roles for LOA updates.';
  }

  return null;
}

async function resolveLoaLogChannel(client) {
  const channel = client.channels.cache.get(LOA_LOG_CHANNEL_ID)
    || await client.channels.fetch(LOA_LOG_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error('The LOA log channel was not found or is not text-based.');
  }

  return channel;
}

function buildLoaEmbed({
  action,
  member,
  personnel,
  staffUser,
  reason,
  expiresAtMs,
  durationLabel,
  automated = false,
}) {
  const started = action === 'started';
  const ended = action === 'ended';
  const expired = action === 'expired';

  const title = started ? 'LOA Started' : ended ? 'LOA Ended' : 'LOA Expired';
  const color = started ? 0xf1c878 : 0x57f287;
  const lines = [
    started
      ? 'A personnel member has been placed on leave of absence.'
      : expired
        ? 'A leave of absence period has reached its end automatically.'
        : 'A personnel member has been returned from leave of absence.',
    '',
    `**Member:** <@${member.id}>`,
    `**Callsign:** ${personnel?.callsign || 'Unknown'}`,
    `**Player Username:** ${personnel?.roblox_username || 'Unknown'}`,
    `**Updated By:** ${staffUser ? `<@${staffUser.id}>` : 'Automatic LOA Tracker'}`,
    `**Reason:** ${reason}`,
  ];

  if (started && durationLabel) {
    lines.push(`**Duration:** ${durationLabel}`);
  }

  if (started && expiresAtMs) {
    lines.push(`**LOA Ends:** ${formatTimestampFromMs(expiresAtMs)}`);
  }

  if (automated) {
    lines.push('**Update Type:** Automatic');
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'SAVE LOA Tracker' })
    .setTimestamp();
}

async function sendLoaLog(client, { embeds, content, pingRoleId } = {}) {
  const channel = await resolveLoaLogChannel(client);
  await channel.send({
    content,
    embeds,
    allowedMentions: pingRoleId
      ? { parse: [], roles: [pingRoleId], users: [] }
      : { parse: [], roles: [], users: [] },
  });
}

async function startLoa({ interaction, member, reason, durationInput }) {
  const durationMs = parseDuration(durationInput);
  if (!durationMs) {
    throw new Error('Use a valid LOA duration like `7d`, `12h`, `3d 6h`, or `90m`.');
  }

  const expiresAtMs = Date.now() + durationMs;
  const personnel = await updatePersonnelStatusByDiscordId(member.id, 'LOA');

  if (!member.roles.cache.has(LOA_ROLE_ID)) {
    await member.roles.add(LOA_ROLE_ID, `LOA started by ${interaction.user.tag}`);
  }

  upsertStateEntry({
    memberId: member.id,
    guildId: interaction.guildId,
    reason,
    durationLabel: formatDurationLabel(durationInput),
    expiresAtMs,
    startedById: interaction.user.id,
    startedByTag: interaction.user.tag,
  });

  const embed = buildLoaEmbed({
    action: 'started',
    member,
    personnel,
    staffUser: interaction.user,
    reason,
    expiresAtMs,
    durationLabel: formatDurationLabel(durationInput),
  });

  await sendLoaLog(interaction.client, { embeds: [embed] });

  return {
    actionLabel: 'started',
    personnel,
    expiresAtMs,
  };
}

async function endLoa({
  client,
  guild,
  member,
  reason,
  staffUser = null,
  automated = false,
}) {
  const personnel = await updatePersonnelStatusByDiscordId(member.id, 'Active');

  if (member.roles.cache.has(LOA_ROLE_ID)) {
    await member.roles.remove(LOA_ROLE_ID, automated ? 'LOA expired automatically' : `LOA ended by ${staffUser?.tag || 'system'}`);
  }

  const existingEntry = getStateEntry(member.id);
  removeStateEntry(member.id);

  const embed = buildLoaEmbed({
    action: automated ? 'expired' : 'ended',
    member,
    personnel,
    staffUser,
    reason,
    expiresAtMs: existingEntry?.expiresAtMs,
    durationLabel: existingEntry?.durationLabel,
    automated,
  });

  await sendLoaLog(client, {
    content: automated ? `<@&${LOA_ALERT_ROLE_ID}>` : undefined,
    embeds: [embed],
    pingRoleId: automated ? LOA_ALERT_ROLE_ID : undefined,
  });

  return {
    actionLabel: automated ? 'expired' : 'ended',
    personnel,
  };
}

async function applyLoaState({
  interaction,
  member,
  reason,
  durationInput,
}) {
  if (!member) {
    throw new Error('I could not resolve that member.');
  }

  const hasLoaRole = member.roles.cache.has(LOA_ROLE_ID);
  if (hasLoaRole) {
    return endLoa({
      client: interaction.client,
      guild: interaction.guild,
      member,
      reason,
      staffUser: interaction.user,
      automated: false,
    });
  }

  return startLoa({
    interaction,
    member,
    reason,
    durationInput,
  });
}

function createLoaNotifier({ client, pollMs = DEFAULT_POLL_MS }) {
  let timer = null;
  let active = false;

  async function tick() {
    if (active) return;
    active = true;

    try {
      const state = loadState();
      const expiredEntries = state.entries.filter((entry) => Number(entry.expiresAtMs) > 0 && Date.now() >= Number(entry.expiresAtMs));

      for (const entry of expiredEntries) {
        try {
          const guild = await client.guilds.fetch(String(entry.guildId));
          const member = await guild.members.fetch(String(entry.memberId));
          await endLoa({
            client,
            guild,
            member,
            reason: entry.reason || 'LOA duration completed.',
            staffUser: null,
            automated: true,
          });
        } catch (error) {
          console.error('Automatic LOA expiry failed:', error);
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
  LOA_ALERT_ROLE_ID,
  LOA_LOG_CHANNEL_ID,
  LOA_ROLE_ID,
  applyLoaState,
  createLoaNotifier,
  fetchMember,
  validateRoleAccess,
};
