const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { closeManagedTicket } = require('../lib/ticket-system');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('closeticket')
    .setDescription('Close the current managed ticket and save its transcript safely.')
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Why is this ticket being closed?')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reason = interaction.options.getString('reason', true);
    await closeManagedTicket(interaction, {
      supportRoleId: process.env.REQUIRED_COMMAND_ROLE_ID,
      ticketCategoryId: process.env.TICKET_CATEGORY_ID,
      appealTicketCategoryId: process.env.APPEAL_TICKET_CATEGORY_ID,
      ticketLogChannelId: process.env.TICKET_LOG_CHANNEL_ID,
    }, reason);
  },
};
