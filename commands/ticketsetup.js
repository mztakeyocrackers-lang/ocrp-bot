const { SlashCommandBuilder } = require('discord.js');
const { createTicketSetupPayload } = require('../lib/ticket-system');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription('Open the ticket setup panel for built-in or custom ticket systems.'),

  async execute(interaction) {
    await interaction.reply({
      ...createTicketSetupPayload(),
      ephemeral: true,
    });
  },
};
