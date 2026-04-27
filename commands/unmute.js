const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  MUTED_ROLE_ID,
  endMute,
  ensureBotCanManage,
} = require('../lib/mute-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute a member by removing the muted role.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who should be unmuted?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for the unmute.')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('member', true);
    const targetMember = interaction.options.getMember('member')
      || await interaction.guild.members.fetch(user.id).catch(() => null);
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    if (!targetMember) {
      await interaction.editReply('I could not resolve that member.');
      return;
    }

    const validationError = await ensureBotCanManage(interaction, targetMember);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    if (!targetMember.roles.cache.has(MUTED_ROLE_ID)) {
      await interaction.editReply('That member is not muted.');
      return;
    }

    const result = await endMute({
      client: interaction.client,
      guild: interaction.guild,
      targetMember,
      reason,
      unmutedBy: interaction.user,
      automatic: false,
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Member Unmuted')
      .setDescription(
        [
          `**Member:** <@${user.id}>`,
          `**Unmuted By:** <@${interaction.user.id}>`,
          `**Reason:** ${reason}`,
        ].join('\n'),
      )
      .setFooter({ text: 'SAVE Assistant Moderation' })
      .setTimestamp();

    await interaction.editReply({
      content: result.delivery === 'fallback'
        ? 'The member was unmuted and their unmute notice was posted in the DM fallback channel because their DMs are closed.'
        : result.delivery === 'failed'
          ? 'The member was unmuted, but I could not deliver the unmute notice by DM or fallback channel.'
          : undefined,
      embeds: [embed],
    });
  },
};
