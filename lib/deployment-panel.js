const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const DEPLOYMENT_THUMBNAIL_URL = 'https://media.discordapp.net/attachments/1479934012482125986/1487914258246406227/download_26.png?ex=69ebd523&is=69ea83a3&hm=8d1ae8673c7cffc1ba34069d0eec95d8df0c6ec174069609f3a131dc8f90f7bb&=&format=webp&quality=lossless&width=465&height=456';
const DEPLOYMENT_PANEL_PREFIX = 'deployment_panel';
const DEPLOYMENT_MODAL_PREFIX = 'deployment_modal';
const AUTO_PING_ROLE_IDS = ['1496740818822762576', '1465136661016084608'];

function encodeRoleId(roleId) {
  return roleId || 'none';
}

function decodeRoleId(encoded) {
  return encoded && encoded !== 'none' ? encoded : null;
}

function buildPanelCustomId(action, roleId) {
  return `${DEPLOYMENT_PANEL_PREFIX}:${action}:${encodeRoleId(roleId)}`;
}

function buildModalCustomId(action, roleId) {
  return `${DEPLOYMENT_MODAL_PREFIX}:${action}:${encodeRoleId(roleId)}`;
}

function parseCustomId(customId, prefix) {
  if (!customId || !customId.startsWith(`${prefix}:`)) {
    return null;
  }

  const [, action, encodedRoleId] = customId.split(':');
  if (!action) {
    return null;
  }

  return {
    action,
    roleId: decodeRoleId(encodedRoleId),
  };
}

function createDeploymentPanelPayload(roleId = null) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('(SAVE) - Deployment Panel')
    .setThumbnail(DEPLOYMENT_THUMBNAIL_URL)
    .setDescription(
      [
        '> Use the buttons below to post a deployment action.',
        '> Choose `Deployment` to post an active deployment notice.',
        '> Choose `Un-Deployment` to post a deployment closure notice.',
      ].join('\n'),
    )
    .setFooter({ text: 'SAVE Assistant Deployment Panel' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildPanelCustomId('deployment', roleId))
      .setLabel('Deployment')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildPanelCustomId('undeployment', roleId))
      .setLabel('Un-Deployment')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

function createDeploymentModal(action, roleId) {
  const isUndeployment = action === 'undeployment';
  const title = isUndeployment ? 'SAVE Un-Deployment' : 'SAVE Deployment';

  const modal = new ModalBuilder()
    .setCustomId(buildModalCustomId(action, roleId))
    .setTitle(title);

  const operationNameInput = new TextInputBuilder()
    .setCustomId('operation_name')
    .setLabel('Operation Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const shiftWatchInput = new TextInputBuilder()
    .setCustomId('shift_watch')
    .setLabel('Shift-Watch')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const shiftSupervisorsInput = new TextInputBuilder()
    .setCustomId('shift_supervisors')
    .setLabel('Shift-Supervisors')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300);

  modal.addComponents(
    new ActionRowBuilder().addComponents(operationNameInput),
    new ActionRowBuilder().addComponents(shiftWatchInput),
    new ActionRowBuilder().addComponents(shiftSupervisorsInput),
  );

  return modal;
}

async function validatePostContext(interaction) {
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

  const needsMentionPermission = AUTO_PING_ROLE_IDS.some((roleId) => {
    const role = interaction.guild.roles.cache.get(roleId);
    return role && !role.mentionable;
  });

  if (needsMentionPermission && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
    return 'I need the `Mention @everyone, @here, and All Roles` permission to ping the deployment roles.';
  }

  return null;
}

async function handleDeploymentButtonInteraction(interaction, { requiredRoleId }) {
  const parsed = parseCustomId(interaction.customId, DEPLOYMENT_PANEL_PREFIX);
  if (!parsed) {
    return false;
  }

  const member = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
  if (!member?.roles?.cache?.has(requiredRoleId)) {
    await interaction.reply({
      content: 'You do not have the required role to use deployment actions.',
      ephemeral: true,
    });
    return true;
  }

  await interaction.showModal(createDeploymentModal(parsed.action, parsed.roleId));
  await interaction.message.delete().catch(() => null);
  return true;
}

async function handleDeploymentModalInteraction(interaction, { requiredRoleId }) {
  const parsed = parseCustomId(interaction.customId, DEPLOYMENT_MODAL_PREFIX);
  if (!parsed) {
    return false;
  }

  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
  if (!member?.roles?.cache?.has(requiredRoleId)) {
    await interaction.editReply('You do not have the required role to use deployment actions.');
    return true;
  }

  const validationError = await validatePostContext(interaction);
  if (validationError) {
    await interaction.editReply(validationError);
    return true;
  }

  const operationName = interaction.fields.getTextInputValue('operation_name');
  const shiftWatch = interaction.fields.getTextInputValue('shift_watch');
  const shiftSupervisors = interaction.fields.getTextInputValue('shift_supervisors');
  const nowUnix = Math.floor(Date.now() / 1000);
  const isUndeployment = parsed.action === 'undeployment';

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(isUndeployment ? '(SAVE) - UN-DEPLOYMENT' : '(SAVE) - DEPLOYMENT')
    .setThumbnail(DEPLOYMENT_THUMBNAIL_URL)
    .setDescription(
      [
        `> **Operation Name:** ${operationName}`,
        `> **Shift-Watch:** ${shiftWatch}`,
        `> **Shift-Supervisors:** ${shiftSupervisors}`,
        `> **Date / Time:** <t:${nowUnix}:F>`,
      ].join('\n'),
    )
    .setFooter({ text: `Posted by ${interaction.user.tag}` })
    .setTimestamp();

  const payload = {
    embeds: [embed],
  };

  if (!isUndeployment) {
    payload.content = AUTO_PING_ROLE_IDS.map((roleId) => `<@&${roleId}>`).join(' ');
    payload.allowedMentions = {
      parse: [],
      roles: AUTO_PING_ROLE_IDS,
    };
  }

  await interaction.channel.send(payload);
  await interaction.editReply(isUndeployment ? 'Un-deployment sent.' : 'Deployment sent.');
  return true;
}

module.exports = {
  createDeploymentPanelPayload,
  handleDeploymentButtonInteraction,
  handleDeploymentModalInteraction,
};
