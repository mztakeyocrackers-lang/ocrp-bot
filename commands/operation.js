const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const OPERATION_THUMBNAIL_URL = 'https://media.discordapp.net/attachments/1479934012482125986/1487914258246406227/download_26.png?ex=69ebd523&is=69ea83a3&hm=8d1ae8673c7cffc1ba34069d0eec95d8df0c6ec174069609f3a131dc8f90f7bb&=&format=webp&quality=lossless&width=465&height=456';
const OPERATION_TIME_ZONE = 'America/Chicago';

async function validatePostContext(interaction, selectedRole) {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return 'I can only post in a text channel.';
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

  if (selectedRole && !selectedRole.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
    return 'I need the `Mention @everyone, @here, and All Roles` permission to ping that role.';
  }

  return null;
}

function parseDateInput(raw) {
  const match = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return null;

  const utcCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    utcCheck.getUTCFullYear() !== year
    || utcCheck.getUTCMonth() !== month - 1
    || utcCheck.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseTimeInput(raw) {
  const value = String(raw || '').trim().toUpperCase();
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const meridiem = match[3];

  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  if (meridiem === 'AM') {
    hour = hour === 12 ? 0 : hour;
  } else {
    hour = hour === 12 ? 12 : hour + 12;
  }

  return { hour, minute };
}

function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function chicagoTimeToUtcMs({ year, month, day, hour, minute }) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute);
  const targetUtcLike = Date.UTC(year, month - 1, day, hour, minute);

  for (let i = 0; i < 4; i += 1) {
    const zoned = getTimeZoneParts(new Date(utcMs), OPERATION_TIME_ZONE);
    const observedUtcLike = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
    );
    const diff = targetUtcLike - observedUtcLike;
    utcMs += diff;
    if (diff === 0) {
      break;
    }
  }

  return utcMs;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('operation')
    .setDescription('Post a formatted SAVE operation management notice.')
    .addStringOption((option) =>
      option
        .setName('operation_name')
        .setDescription('The name of the operation.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('operation_date')
        .setDescription('Operation date in MM/DD/YYYY format.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('operation_time')
        .setDescription('Operation time like 7:30 PM.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('operation_watch')
        .setDescription('The operation watch.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('operation_supervisors')
        .setDescription('The operation supervisors.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('code_officer')
        .setDescription('The code officer regulating lawful actions.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('briefing_date')
        .setDescription('Briefing date in MM/DD/YYYY format.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('briefing_time')
        .setDescription('Briefing time like 6:45 PM.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('planned_vehicle_usage')
        .setDescription('Planned vehicle usage.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('operation_severity')
        .setDescription('Severity of the operation.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('joint_operation')
        .setDescription('If working with others, who and why.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('operation_notes')
        .setDescription('Operation notes or summary.')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('ping_role')
        .setDescription('Optional role to ping with this operation post.')
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('ping_member')
        .setDescription('Optional member to ping with this operation post.')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const operationName = interaction.options.getString('operation_name', true);
    const operationDate = interaction.options.getString('operation_date', true);
    const operationTime = interaction.options.getString('operation_time', true);
    const operationWatch = interaction.options.getString('operation_watch', true);
    const operationSupervisors = interaction.options.getString('operation_supervisors', true);
    const codeOfficer = interaction.options.getString('code_officer', true);
    const briefingDate = interaction.options.getString('briefing_date', true);
    const briefingTime = interaction.options.getString('briefing_time', true);
    const plannedVehicleUsage = interaction.options.getString('planned_vehicle_usage', true);
    const operationSeverity = interaction.options.getString('operation_severity', true);
    const jointOperation = interaction.options.getString('joint_operation', true);
    const operationNotes = interaction.options.getString('operation_notes', true);
    const pingRole = interaction.options.getRole('ping_role');
    const pingMember = interaction.options.getUser('ping_member');

    const validationError = await validatePostContext(interaction, pingRole);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    const parsedDate = parseDateInput(operationDate);
    const parsedTime = parseTimeInput(operationTime);
    const parsedBriefingDate = parseDateInput(briefingDate);
    const parsedBriefingTime = parseTimeInput(briefingTime);

    if (!parsedDate || !parsedTime || !parsedBriefingDate || !parsedBriefingTime) {
      await interaction.editReply('Use valid dates like `04/30/2026` and valid times like `7:30 PM`.');
      return;
    }

    const operationTimestampUnix = Math.floor(chicagoTimeToUtcMs({
      ...parsedDate,
      ...parsedTime,
    }) / 1000);
    const briefingTimestampUnix = Math.floor(chicagoTimeToUtcMs({
      ...parsedBriefingDate,
      ...parsedBriefingTime,
    }) / 1000);

    try {
      const embed = new EmbedBuilder()
        .setColor(0x1f3b5b)
        .setTitle('(SAVE) - OPERATION MANAGEMENT')
        .setThumbnail(OPERATION_THUMBNAIL_URL)
        .setDescription(
          [
            `> **Operation Name:** ${operationName}`,
            `> **Operation Watch:** ${operationWatch}`,
            `> **Operation Supervisors:** ${operationSupervisors}`,
            '------------------------------',
            `> **Code Officer:** ${codeOfficer}`,
            `> **Briefing Scheduled Time:** <t:${briefingTimestampUnix}:F>`,
            `> **Relative Start To Briefing:** <t:${briefingTimestampUnix}:R>`,
            '------------------------------',
            `> **Planned Vehicle Usage:** ${plannedVehicleUsage}`,
            `> **Severity Of The Operation:** ${operationSeverity}`,
            `> **Working With Others:** ${jointOperation}`,
            '------------------------------',
            `> **Scheduled Time / Date:** <t:${operationTimestampUnix}:F>`,
            `> **Relative Start:** <t:${operationTimestampUnix}:R>`,
            `> **Operation Notes:** ${operationNotes}`,
          ].join('\n'),
        )
        .setFooter({ text: `Posted by ${interaction.user.tag}` })
        .setTimestamp();

      const mentions = [];
      const allowedMentions = {
        parse: [],
        roles: [],
        users: [],
      };

      if (pingRole) {
        mentions.push(`<@&${pingRole.id}>`);
        allowedMentions.roles.push(pingRole.id);
      }

      if (pingMember) {
        mentions.push(`<@${pingMember.id}>`);
        allowedMentions.users.push(pingMember.id);
      }

      const payload = {
        embeds: [embed],
      };

      if (mentions.length) {
        payload.content = mentions.join(' ');
        payload.allowedMentions = allowedMentions;
      }

      await interaction.channel.send(payload);
      await interaction.editReply('Operation management post sent.');
    } catch (error) {
      console.error('Operation post failed:', error);
      await interaction.editReply('I hit an error while posting the operation notice.');
    }
  },
};
