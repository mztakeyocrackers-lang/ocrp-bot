const { SlashCommandBuilder } = require('discord.js');
const { getManagedTicketContext } = require('../lib/ticket-system');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-add')
    .setDescription('Add a user to the current managed ticket.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('User to add to this ticket.')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.reply({
        content: 'This command only works inside a ticket channel.',
        ephemeral: true,
      });
      return;
    }

    const ticketInfo = getManagedTicketContext(interaction.channel);

    if (!ticketInfo) {
      await interaction.reply({
        content: 'This command only works inside a managed ticket thread.',
        ephemeral: true,
      });
      return;
    }

    const member = interaction.options.getUser('member', true);

    try {
      if (ticketInfo.mode === 'thread' && interaction.channel.isThread()) {
        await interaction.channel.members.add(member.id);
      } else {
        await interaction.channel.permissionOverwrites.edit(member.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true,
        });
      }
    } catch (error) {
      console.error('ticket-add failed:', error);
      await interaction.reply({
        content: 'I could not add that user to this ticket.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Added <@${member.id}> to this ticket.`,
      ephemeral: true,
    });
  },
};
