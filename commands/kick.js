const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  ensureBotCanKick,
  startKick,
} = require('../lib/ban-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who should be kicked?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for the kick.')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('member', true);
    const targetMember = interaction.options.getMember('member')
      || await interaction.guild.members.fetch(user.id).catch(() => null);
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    if (!targetMember) {
      await interaction.editReply('I could not resolve that member. They may have already left the server.');
      return;
    }

    if (user.id === interaction.user.id) {
      await interaction.editReply('You cannot kick yourself.');
      return;
    }

    const validationError = await ensureBotCanKick(interaction, targetMember);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    let result;
    try {
      result = await startKick({
        interaction,
        targetMember,
        reason,
      });
    } catch (error) {
      await interaction.editReply(error.message || 'I could not kick that member.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Member Kicked')
      .setDescription(
        [
          `**Member:** <@${user.id}>`,
          `**Kicked By:** <@${interaction.user.id}>`,
          `**Reason:** ${reason}`,
        ].join('\n'),
      )
      .setFooter({ text: 'SAVE Assistant Moderation' })
      .setTimestamp();

    await interaction.editReply({
      content: result.delivery === 'fallback'
        ? 'The member was kicked and their kick notice was posted in the DM fallback channel because their DMs are closed.'
        : result.delivery === 'failed'
          ? 'The member was kicked, but I could not deliver the kick notice by DM or fallback channel.'
          : undefined,
      embeds: [embed],
    });
  },
};
