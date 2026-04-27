const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  ensureBotCanBan,
  formatTimestampFromMs,
  startBan,
} = require('../lib/ban-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server, optionally with a temporary duration.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who should be banned?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Optional ban length, like 30m, 2h, 1d, 7d, or perm.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for the ban.')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('member', true);
    const targetMember = interaction.options.getMember('member')
      || await interaction.guild.members.fetch(user.id).catch(() => null);
    const durationInput = interaction.options.getString('duration') || '';
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    if (user.id === interaction.user.id) {
      await interaction.editReply('You cannot ban yourself.');
      return;
    }

    const validationError = await ensureBotCanBan(interaction, targetMember);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    let result;
    try {
      result = await startBan({
        interaction,
        targetUser: user,
        targetMember,
        reason,
        durationInput,
      });
    } catch (error) {
      await interaction.editReply(error.message || 'I could not ban that user.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('User Banned')
      .setDescription(
        [
          `**User:** <@${user.id}>`,
          `**Banned By:** <@${interaction.user.id}>`,
          `**Reason:** ${reason}`,
          `**Ban Length:** ${result.permanent ? 'Permanent' : formatTimestampFromMs(result.expiresAtMs)}`,
        ].join('\n'),
      )
      .setFooter({ text: 'SAVE Assistant Moderation' })
      .setTimestamp();

    await interaction.editReply({
      content: result.delivery === 'fallback'
        ? 'The user was banned and their ban notice was posted in the DM fallback channel because their DMs are closed.'
        : result.delivery === 'failed'
          ? 'The user was banned, but I could not deliver the ban notice by DM or fallback channel.'
          : undefined,
      embeds: [embed],
    });
  },
};
