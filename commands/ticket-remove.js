const { SlashCommandBuilder } = require('discord.js');
const { getManagedTicketContext } = require('../lib/ticket-system');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-remove')
    .setDescription('Remove a user from the current managed ticket.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('User to remove from this ticket.')
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

    if (member.id === ticketInfo.ownerId) {
      await interaction.reply({
        content: 'You cannot remove the original ticket opener from their own ticket.',
        ephemeral: true,
      });
      return;
    }

    try {
      if (ticketInfo.mode === 'thread' && interaction.channel.isThread()) {
        await interaction.channel.members.remove(member.id);
      } else {
        await interaction.channel.permissionOverwrites.delete(member.id);
      }
    } catch (error) {
      console.error('ticket-remove failed:', error);
      await interaction.reply({
        content: 'I could not remove that user from this ticket.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Removed <@${member.id}> from this ticket. If they still have access, it is likely coming from another role.`,
      ephemeral: true,
    });
  },
};
