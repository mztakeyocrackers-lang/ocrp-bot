const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { sendUserNotification } = require('./notification-utils');

const PROMOTION_COOLDOWN_ROLE_ID = process.env.PROMOTION_COOLDOWN_ROLE_ID || '1498045235052417104';
const PROMOTION_COOLDOWN_STATE_FILE = path.join(__dirname, '..', 'data', 'promotion-cooldown-state.json');
const DEFAULT_POLL_MS = 30000;

function ensureStateDir() {
  fs.mkdirSync(path.dirname(PROMOTION_COOLDOWN_STATE_FILE), { recursive: true });
}

function loadState() {
  ensureStateDir();
  try {
    const raw = fs.readFileSync(PROMOTION_COOLDOWN_STATE_FILE, 'utf8');
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
  fs.writeFileSync(PROMOTION_COOLDOWN_STATE_FILE, JSON.stringify({
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

function getPromotionCooldownEntry(memberId) {
  return loadState().entries.find((item) => String(item.memberId) === String(memberId)) || null;
}

function parseMinutes(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  return minutes;
}

function formatTimestampFromMs(value) {
  const unix = Math.floor(Number(value) / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return 'Unknown';
  return `<t:${unix}:F> - <t:${unix}:R>`;
}

function formatMinutesLabel(minutes) {
  const totalMinutes = Number(minutes) || 0;
  if (totalMinutes <= 0) {
    return 'Unknown';
  }

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);

  const compact = parts.join(' ') || `${totalMinutes}m`;
  return `${totalMinutes} minute(s) (${compact})`;
}

async function ensureBotCanManageCooldown(interaction, targetMember) {
  if (!interaction.inGuild() || !interaction.channel || !interaction.channel.isTextBased()) {
    return 'This can only be used in a server text channel.';
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
    return 'I need permission to manage roles for promotion cooldown updates.';
  }

  const cooldownRole = interaction.guild.roles.cache.get(PROMOTION_COOLDOWN_ROLE_ID)
    || await interaction.guild.roles.fetch(PROMOTION_COOLDOWN_ROLE_ID).catch(() => null);
  if (!cooldownRole) {
    return 'The promotion cooldown role is not configured correctly.';
  }

  if (me.roles.highest.comparePositionTo(cooldownRole) <= 0) {
    return 'My role is not high enough to manage the promotion cooldown role.';
  }

  if (!targetMember.manageable) {
    return 'I cannot update roles for that member because of role hierarchy.';
  }

  return null;
}

async function sendPromotionCooldownNotice({
  client,
  user,
  updatedBy,
  reason,
  startedAtMs,
  expiresAtMs,
  durationMinutes,
}) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle('Promotion Cooldown Applied')
    .setDescription([
      'You have been placed on a promotion cooldown.',
      '',
      `**Updated By:** <@${updatedBy.id}>`,
      `**Reason:** ${reason}`,
      `**Started:** ${formatTimestampFromMs(startedAtMs)}`,
      `**Ends:** ${formatTimestampFromMs(expiresAtMs)}`,
      `**Duration:** ${formatMinutesLabel(durationMinutes)}`,
    ].join('\n'))
    .setFooter({ text: 'SAVE Assistant Personnel' })
    .setTimestamp();

  return sendUserNotification({
    client,
    user,
    embeds: [embed],
    fallbackPrefix: 'Promotion cooldown DM delivery failed. Posting the notice here instead.',
  });
}

async function sendPromotionCooldownEndNotice({
  client,
  user,
  updatedBy,
  reason,
  automatic = false,
}) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(automatic ? 'Promotion Cooldown Expired' : 'Promotion Cooldown Ended')
    .setDescription([
      automatic
        ? 'Your promotion cooldown has ended automatically.'
        : 'Your promotion cooldown has been removed.',
      '',
      `**Updated By:** ${automatic ? 'Automatic cooldown timer' : `<@${updatedBy.id}>`}`,
      `**Reason:** ${reason}`,
    ].join('\n'))
    .setFooter({ text: 'SAVE Assistant Personnel' })
    .setTimestamp();

  return sendUserNotification({
    client,
    user,
    embeds: [embed],
    fallbackPrefix: 'Promotion cooldown end DM delivery failed. Posting the notice here instead.',
  });
}

async function startPromotionCooldown({ interaction, targetMember, reason, minutes }) {
  const durationMinutes = parseMinutes(minutes);
  if (!durationMinutes) {
    throw new Error('Use a valid number of minutes like `60`, `1440`, or `10080`.');
  }

  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + (durationMinutes * 60 * 1000);
  const existingEntry = getPromotionCooldownEntry(targetMember.id);
  const alreadyHadRole = targetMember.roles.cache.has(PROMOTION_COOLDOWN_ROLE_ID);

  if (!alreadyHadRole) {
    await targetMember.roles.add(PROMOTION_COOLDOWN_ROLE_ID, `Promotion cooldown set by ${interaction.user.tag}: ${reason}`);
  }

  upsertStateEntry({
    memberId: targetMember.id,
    guildId: interaction.guildId,
    reason,
    startedAtMs,
    expiresAtMs,
    durationMinutes,
    updatedById: interaction.user.id,
    updatedByTag: interaction.user.tag,
  });

  const notice = await sendPromotionCooldownNotice({
    client: interaction.client,
    user: targetMember.user,
    updatedBy: interaction.user,
    reason,
    startedAtMs,
    expiresAtMs,
    durationMinutes,
  }).catch(() => ({ deliveredVia: 'failed' }));

  return {
    actionLabel: existingEntry || alreadyHadRole ? 'updated' : 'started',
    expiresAtMs,
    durationMinutes,
    delivery: notice.deliveredVia || 'failed',
  };
}

async function endPromotionCooldown({
  client,
  guild,
  targetMember,
  reason,
  updatedBy = null,
  automatic = false,
}) {
  const hasRole = targetMember.roles.cache.has(PROMOTION_COOLDOWN_ROLE_ID);
  if (hasRole) {
    await targetMember.roles.remove(
      PROMOTION_COOLDOWN_ROLE_ID,
      automatic ? 'Promotion cooldown expired automatically' : `Promotion cooldown cleared by ${updatedBy?.tag || 'system'}: ${reason}`,
    );
  }

  removeStateEntry(targetMember.id);

  const notice = await sendPromotionCooldownEndNotice({
    client,
    user: targetMember.user,
    updatedBy,
    reason,
    automatic,
  }).catch(() => ({ deliveredVia: 'failed' }));

  return {
    actionLabel: automatic ? 'expired' : 'ended',
    delivery: notice.deliveredVia || 'failed',
  };
}

async function applyPromotionCooldownState({
  interaction,
  member,
  reason,
  minutesInput,
}) {
  if (!member) {
    throw new Error('I could not resolve that member.');
  }

  const validationError = await ensureBotCanManageCooldown(interaction, member);
  if (validationError) {
    throw new Error(validationError);
  }

  const hasExistingCooldown = member.roles.cache.has(PROMOTION_COOLDOWN_ROLE_ID) || Boolean(getPromotionCooldownEntry(member.id));
  const trimmedMinutes = String(minutesInput || '').trim();

  if (hasExistingCooldown && !trimmedMinutes) {
    return endPromotionCooldown({
      client: interaction.client,
      guild: interaction.guild,
      targetMember: member,
      reason,
      updatedBy: interaction.user,
      automatic: false,
    });
  }

  return startPromotionCooldown({
    interaction,
    targetMember: member,
    reason,
    minutes: trimmedMinutes,
  });
}

function createPromotionCooldownNotifier({ client, pollMs = DEFAULT_POLL_MS }) {
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
          const member = await guild.members.fetch(String(entry.memberId)).catch(() => null);

          if (!member) {
            removeStateEntry(entry.memberId);
            continue;
          }

          await endPromotionCooldown({
            client,
            guild,
            targetMember: member,
            reason: entry.reason || 'Promotion cooldown completed.',
            updatedBy: null,
            automatic: true,
          });
        } catch (error) {
          console.error('Automatic promotion cooldown expiry failed:', error);
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
  PROMOTION_COOLDOWN_ROLE_ID,
  applyPromotionCooldownState,
  createPromotionCooldownNotifier,
  getPromotionCooldownEntry,
  formatMinutesLabel,
  formatTimestampFromMs,
};
