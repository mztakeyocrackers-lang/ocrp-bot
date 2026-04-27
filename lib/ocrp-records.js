const { EmbedBuilder } = require('discord.js');
const { insertRows, updateRows } = require('./ocrp-db');
const { recordAuditEvent } = require('./ocrp-audit');
const { MODULE_DEFINITIONS } = require('./ocrp-guild-config');
const { assertGuildModuleAccess } = require('./ocrp-access');

const RECORD_TABLES = {
  patrol: {
    table: 'patrol_logs',
    color: 0x4a90e2,
    title: 'OCRP Patrol Log',
    successTitle: 'Patrol Logged',
  },
  arrest: {
    table: 'arrest_logs',
    color: 0xe67e22,
    title: 'OCRP Arrest Log',
    successTitle: 'Arrest Logged',
  },
  promotion: {
    table: 'promotion_logs',
    color: 0x57f287,
    title: 'OCRP Promotion Log',
    successTitle: 'Promotion Logged',
  },
  demotion: {
    table: 'demotion_logs',
    color: 0xed4245,
    title: 'OCRP Demotion Log',
    successTitle: 'Demotion Logged',
  },
  blacklist: {
    table: 'blacklist_records',
    color: 0xffffff,
    title: 'OCRP Blacklist Record',
    successTitle: 'Blacklist Recorded',
  },
};

function cleanText(value, fallback = 'Not provided', max = 1024) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, max);
}

function friendlyFieldLabel(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function metadataToFields(metadata = {}) {
  return Object.entries(metadata || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => ({
      name: friendlyFieldLabel(key),
      value: cleanText(value, 'Not provided'),
      inline: true,
    }))
    .slice(0, 12);
}

function buildRecordEmbed(type, record, guildName) {
  const meta = RECORD_TABLES[type];
  const metadata = record.metadata || {};

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(cleanText(record.reason, 'No reason provided.'))
    .addFields(
      { name: 'Guild', value: cleanText(guildName || record.guild_id, 'Unknown guild'), inline: true },
      { name: 'Department', value: cleanText(record.department, 'Not provided'), inline: true },
      { name: 'Recorded By', value: cleanText(record.acting_staff_tag, 'Unknown staff'), inline: true },
      { name: 'Target', value: cleanText(record.target_name || record.target_discord_tag, 'Not provided'), inline: true },
      { name: 'Roblox', value: cleanText(record.roblox_username || record.roblox_id, 'Not provided'), inline: true },
      { name: 'Evidence', value: cleanText(record.evidence_url, 'Not provided'), inline: true },
      { name: 'Notes', value: cleanText(record.notes, 'No extra notes.'), inline: false },
      ...metadataToFields(metadata),
    )
    .setFooter({ text: `OCRP Core Ops • ${friendlyFieldLabel(type)}` })
    .setTimestamp(new Date(record.created_at || Date.now()));
}

async function createOperationalRecord({
  type,
  interaction,
  department,
  reason,
  notes = '',
  evidenceUrl = '',
  target = {},
  roblox = {},
  metadata = {},
}) {
  const meta = RECORD_TABLES[type];
  if (!meta) {
    throw new Error(`Unsupported OCRP record type "${type}".`);
  }

  const rows = await insertRows(meta.table, {
    guild_id: interaction.guildId,
    department: cleanText(department, 'Not provided', 120),
    acting_staff_discord_id: interaction.user.id,
    acting_staff_tag: interaction.user.tag,
    acting_staff_display_name: interaction.member?.displayName || interaction.user.username,
    target_discord_id: target.discordId || null,
    target_discord_tag: target.discordTag || null,
    target_name: cleanText(target.name, ''),
    roblox_username: cleanText(roblox.username, ''),
    roblox_id: cleanText(roblox.id, ''),
    reason: cleanText(reason, 'No reason provided.'),
    notes: cleanText(notes, ''),
    evidence_url: cleanText(evidenceUrl, ''),
    mirrored_channel_id: null,
    mirrored_message_id: null,
    metadata,
  });

  const record = Array.isArray(rows) ? rows[0] || null : rows || null;
  if (!record) {
    throw new Error(`The ${type} record was not saved.`);
  }

  await recordAuditEvent({
    guildId: interaction.guildId,
    actorDiscordId: interaction.user.id,
    actorTag: interaction.user.tag,
    action: `COMMAND_${type.toUpperCase()}_CREATE`,
    targetType: type,
    targetId: record.id,
    summary: `${interaction.user.tag} created an OCRP ${type} record.`,
    metadata: {
      department,
      targetName: target.name || target.discordTag || null,
    },
  });

  return record;
}

async function mirrorOperationalRecord({
  client,
  type,
  record,
  guildName,
  guildConfig,
}) {
  const meta = RECORD_TABLES[type];
  const moduleConfig = MODULE_DEFINITIONS[type];
  const channelId = guildConfig[moduleConfig.channelField];
  if (!channelId) {
    throw new Error(`No ${moduleConfig.label.toLowerCase()} log channel is configured.`);
  }

  const channel =
    client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Configured ${moduleConfig.label.toLowerCase()} log channel is not available.`);
  }

  const message = await channel.send({
    embeds: [buildRecordEmbed(type, record, guildName)],
    allowedMentions: { parse: [] },
  });

  const updatedRows = await updateRows(meta.table, {
    mirrored_channel_id: channel.id,
    mirrored_message_id: message.id,
  }, {
    id: `eq.${record.id}`,
  });

  return {
    message,
    record: Array.isArray(updatedRows) ? updatedRows[0] || record : updatedRows || record,
  };
}

function buildSuccessEmbed(type, record, mirrorStatus) {
  const meta = RECORD_TABLES[type];
  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.successTitle)
    .setDescription('The OCRP record has been saved to the OCRP database.')
    .addFields(
      { name: 'Department', value: cleanText(record.department, 'Not provided'), inline: true },
      { name: 'Record ID', value: cleanText(record.id, 'Unavailable'), inline: true },
      { name: 'Mirror Status', value: cleanText(mirrorStatus, 'Unknown'), inline: true },
    )
    .setFooter({ text: 'OCRP Core Ops' })
    .setTimestamp(new Date(record.created_at || Date.now()));

  return embed;
}

async function executeOperationalCommand(interaction, {
  type,
  department,
  reason,
  notes = '',
  evidenceUrl = '',
  target = {},
  roblox = {},
  metadata = {},
}) {
  await interaction.deferReply({ ephemeral: true });

  const access = await assertGuildModuleAccess(interaction, type);
  const record = await createOperationalRecord({
    type,
    interaction,
    department,
    reason,
    notes,
    evidenceUrl,
    target,
    roblox,
    metadata,
  });

  let mirrorStatus = 'Saved to database only';

  try {
    const mirrored = await mirrorOperationalRecord({
      client: interaction.client,
      type,
      record,
      guildName: interaction.guild?.name,
      guildConfig: access.config,
    });

    if (mirrored?.message?.id) {
      mirrorStatus = `Posted to <#${mirrored.message.channelId}>`;
    }
  } catch (error) {
    console.error(`OCRP ${type} mirror failed:`, error);
    mirrorStatus = 'Database saved, Discord mirror failed';
  }

  await interaction.editReply({
    embeds: [buildSuccessEmbed(type, record, mirrorStatus)],
  });
}

module.exports = {
  RECORD_TABLES,
  buildRecordEmbed,
  executeOperationalCommand,
};
