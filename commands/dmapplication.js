const { SlashCommandBuilder } = require('discord.js');
const { startOrResumeApplication } = require('../lib/dm-application');

module.exports = {
  allowWithoutRole: true,
  data: new SlashCommandBuilder()
    .setName('dmapplication')
    .setDescription('Start the SAVE written application in direct messages.'),

  async execute(interaction) {
    await startOrResumeApplication({
      client: interaction.client,
      interaction,
    });
  },
};
