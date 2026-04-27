const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { createDeploymentPanelPayload } = require('../lib/deployment-panel');

async function validateChannel(interaction) {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return 'I can only post the deployment panel in a text channel.';
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

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deploymentpanel')
    .setDescription('Post the SAVE deployment action panel.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const validationError = await validateChannel(interaction);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    await interaction.editReply(createDeploymentPanelPayload(null));
  },
};
