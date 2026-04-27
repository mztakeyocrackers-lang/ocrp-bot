const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete a number of recent messages from this channel.')
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('How many recent messages to delete from this channel.')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.editReply('I can only purge messages in a text channel.');
      return;
    }

    const me = interaction.guild.members.me
      || await interaction.guild.members.fetchMe().catch(() => null);

    if (!me) {
      await interaction.editReply('I could not verify my server permissions.');
      return;
    }

    const permissions = interaction.channel.permissionsFor(me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
      await interaction.editReply('I need permission to view this channel.');
      return;
    }

    if (!permissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.editReply('I need the `Manage Messages` permission to purge this channel.');
      return;
    }

    const amount = interaction.options.getInteger('amount', true);

    try {
      const fetched = await interaction.channel.messages.fetch({ limit: amount });
      const messages = [...fetched.values()]
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(0, amount);

      if (!messages.length) {
        await interaction.editReply('There were no messages available to delete in this channel.');
        return;
      }

      const cutoff = Date.now() - FOURTEEN_DAYS_MS;
      const recentMessages = messages.filter((message) => message.createdTimestamp > cutoff);
      const oldMessages = messages.filter((message) => message.createdTimestamp <= cutoff);

      let deletedCount = 0;
      let failedCount = 0;

      if (recentMessages.length) {
        const bulkDeleted = await interaction.channel.bulkDelete(recentMessages, true).catch(() => null);
        deletedCount += bulkDeleted?.size || 0;
      }

      for (const message of oldMessages) {
        if (!message.deletable) {
          failedCount += 1;
          continue;
        }

        try {
          await message.delete();
          deletedCount += 1;
        } catch (error) {
          failedCount += 1;
        }
      }

      if (!deletedCount) {
        await interaction.editReply('I could not delete any of the requested messages in this channel.');
        return;
      }

      const status = failedCount
        ? `Deleted ${deletedCount} message(s) from ${interaction.channel}. ${failedCount} could not be deleted.`
        : `Deleted ${deletedCount} message(s) from ${interaction.channel}.`;

      await interaction.editReply(status);
    } catch (error) {
      console.error('Purge command failed:', error);
      await interaction.editReply('I could not purge messages in this channel.');
    }
  },
};
