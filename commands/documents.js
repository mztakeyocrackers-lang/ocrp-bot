const { SlashCommandBuilder } = require('discord.js');
const { postInfoTemplate } = require('../lib/info-panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('documents')
    .setDescription('Post the SAVE documents embed.'),

  async execute(interaction) {
    await postInfoTemplate(interaction, 'documents', 'Documents embed sent.');
  },
};
