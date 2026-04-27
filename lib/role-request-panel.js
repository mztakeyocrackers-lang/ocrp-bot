const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const ROLE_REQUEST_PANEL_ID = 'role_request_panel';
const ROLE_REQUEST_MODAL_ID = 'role_request_modal';
const VERIFIED_ROLE_ID = process.env.ROLE_REQUEST_REQUIRED_ROLE_ID || '1465136660969820304';
const ROLE_REQUEST_CHANNEL_ID = process.env.ROLE_REQUEST_CHANNEL_ID || '1497858144368459806';
const ROLE_REQUEST_ALERT_ROLE_ID = process.env.ROLE_REQUEST_ALERT_ROLE_ID || '1465136661187924105';
const ADMIN_EXEMPT_ROLE_ID = process.env.REQUIRED_COMMAND_ROLE_ID || '1465136661187924105';

function buildPanelCustomId(action) {
  return `${ROLE_REQUEST_PANEL_ID}:${action}`;
}

function createRoleRequestPanelPayload(statusText = null) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('SAVE Role Request Panel')
    .setDescription([
      '> Use this panel to submit a role request for SAVE command review.',
      '> Fill the request out clearly so staff can understand what you need and why.',
      '> Refresh keeps the panel current. Cancel closes it for you.',
      statusText ? '' : null,
      statusText ? `**Status**\n> ${statusText}` : null,
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: 'Request Review',
        value: [
          '> Submit the role you are requesting.',
          '> Explain why you need it.',
          '> Include relevant experience, qualifications, or context.',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant Role Requests' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildPanelCustomId('submit'))
      .setLabel('Submit Request')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildPanelCustomId('refresh'))
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildPanelCustomId('cancel'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  };
}

async function validateRoleRequestContext(interaction, member) {
  if (!interaction.inGuild()) {
    return 'This command only works inside the server.';
  }

  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return 'I can only open the role request panel in a text channel.';
  }

  const hasAdminExemption = Boolean(member?.roles?.cache?.has(ADMIN_EXEMPT_ROLE_ID));
  const hasVerifiedRole = Boolean(member?.roles?.cache?.has(VERIFIED_ROLE_ID));

  if (!hasAdminExemption && !hasVerifiedRole) {
    return 'You do not have the required role to use role requests.';
  }

  if (!hasAdminExemption && interaction.channelId !== ROLE_REQUEST_CHANNEL_ID) {
    return `You can only use \`/rolerequest\` in <#${ROLE_REQUEST_CHANNEL_ID}>.`;
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

  if (!permissions.has(PermissionFlagsBits.MentionEveryone)) {
    return 'I need permission to ping the review role in this channel.';
  }

  return null;
}

function createRoleRequestModal() {
  const modal = new ModalBuilder()
    .setCustomId(ROLE_REQUEST_MODAL_ID)
    .setTitle('Submit Role Request');

  const requestedRoleInput = new TextInputBuilder()
    .setCustomId('requested_role')
    .setLabel('Requested Role')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Why are you requesting it?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const qualificationsInput = new TextInputBuilder()
    .setCustomId('qualifications')
    .setLabel('Relevant experience or qualifications')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Additional notes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400);

  modal.addComponents(
    new ActionRowBuilder().addComponents(requestedRoleInput),
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(qualificationsInput),
    new ActionRowBuilder().addComponents(notesInput),
  );

  return modal;
}

async function handleRoleRequestButtonInteraction(interaction) {
  if (!interaction.customId?.startsWith(`${ROLE_REQUEST_PANEL_ID}:`)) {
    return false;
  }

  const member = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
  const validationError = await validateRoleRequestContext(interaction, member);
  if (validationError) {
    await interaction.reply({
      content: validationError,
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
    return true;
  }

  const [, action] = interaction.customId.split(':');

  if (action === 'submit') {
    await interaction.showModal(createRoleRequestModal());
    return true;
  }

  if (action === 'refresh') {
    await interaction.update(createRoleRequestPanelPayload('Panel refreshed.'));
    return true;
  }

  if (action === 'cancel') {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle('SAVE Role Request Panel')
          .setDescription('> Role request panel closed.')
          .setFooter({ text: 'SAVE Assistant Role Requests' })
          .setTimestamp(),
      ],
      components: [],
    });
    return true;
  }

  return false;
}

async function handleRoleRequestModalInteraction(interaction) {
  if (interaction.customId !== ROLE_REQUEST_MODAL_ID) {
    return false;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
  const validationError = await validateRoleRequestContext(interaction, member);
  if (validationError) {
    await interaction.editReply(validationError);
    return true;
  }

  const requestedRole = interaction.fields.getTextInputValue('requested_role');
  const reason = interaction.fields.getTextInputValue('reason');
  const qualifications = interaction.fields.getTextInputValue('qualifications');
  const notes = interaction.fields.getTextInputValue('notes').trim();

  const embed = new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle('SAVE Role Request')
    .setDescription('A personnel member has submitted a role request for command review.')
    .addFields(
      {
        name: 'Requested By',
        value: `<@${interaction.user.id}>`,
        inline: false,
      },
      {
        name: 'Requested Role',
        value: requestedRole,
        inline: false,
      },
      {
        name: 'Reason',
        value: reason,
        inline: false,
      },
      {
        name: 'Relevant Experience / Qualifications',
        value: qualifications,
        inline: false,
      },
      ...(notes ? [{
        name: 'Additional Notes',
        value: notes,
        inline: false,
      }] : []),
    )
    .setFooter({ text: 'SAVE Assistant Role Requests' })
    .setTimestamp();

  await interaction.channel.send({
    content: `<@&${ROLE_REQUEST_ALERT_ROLE_ID}>`,
    embeds: [embed],
    allowedMentions: {
      parse: [],
      roles: [ROLE_REQUEST_ALERT_ROLE_ID],
      users: [interaction.user.id],
    },
  });

  await interaction.editReply('Your role request was sent for command review.');
  return true;
}

module.exports = {
  ROLE_REQUEST_CHANNEL_ID,
  VERIFIED_ROLE_ID,
  createRoleRequestPanelPayload,
  validateRoleRequestContext,
  handleRoleRequestButtonInteraction,
  handleRoleRequestModalInteraction,
};
