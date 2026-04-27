const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  ensureBotCanManage,
  formatTimestampFromMs,
  startMute,
} = require('../lib/mute-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member by assigning the muted role.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who should be muted?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('How long to mute them for, like 30m, 2h, 1d, or 1d 12h.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for the mute.')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('member', true);
    const targetMember = interaction.options.getMember('member')
      || await interaction.guild.members.fetch(user.id).catch(() => null);
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const durationInput = interaction.options.getString('duration', true);

    if (!targetMember) {
      await interaction.editReply('I could not resolve that member.');
      return;
    }

    const validationError = await ensureBotCanManage(interaction, targetMember);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    let result;
    try {
      result = await startMute({
        interaction,
        targetMember,
        reason,
        durationInput,
      });
    } catch (error) {
      await interaction.editReply(error.message || 'I could not start that mute.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Member Muted')
      .setDescription(
        [
          `**Member:** <@${user.id}>`,
          `**Muted By:** <@${interaction.user.id}>`,
          `**Reason:** ${reason}`,
          `**Mute Ends:** ${formatTimestampFromMs(result.expiresAtMs)}`,
        ].join('\n'),
      )
      .setFooter({ text: 'SAVE Assistant Moderation' })
      .setTimestamp();

    await interaction.editReply({
      content: result.delivery === 'fallback'
        ? 'The member was muted and their mute notice was posted in the DM fallback channel because their DMs are closed.'
        : result.delivery === 'failed'
          ? 'The member was muted, but I could not deliver the mute notice by DM or fallback channel.'
          : undefined,
      embeds: [embed],
    });
  },
};
