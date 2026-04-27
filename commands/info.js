const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createInfoPanelPayload } = require('../lib/info-panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Open the SAVE information panel with all information post types.'),

  async execute(interaction) {
    await interaction.reply({
      ...createInfoPanelPayload(),
      flags: MessageFlags.Ephemeral,
    });
  },
};
