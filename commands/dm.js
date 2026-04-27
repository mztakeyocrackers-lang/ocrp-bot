const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { formatQuotedMessage } = require('../lib/post-utils');
const { sendUserNotification } = require('../lib/notification-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message to a selected user.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who should receive the direct message?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The message to send.')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.options.getUser('member', true);
    const message = interaction.options.getString('message', true);

    try {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(`# Direct Message\n\n${formatQuotedMessage(message)}`)
        .setFooter({ text: `Sent by ${interaction.user.tag} via Save Assistant` })
        .setTimestamp();

      const result = await sendUserNotification({
        client: interaction.client,
        user: member,
        embeds: [embed],
        fallbackPrefix: 'Direct messages are closed. Posting the message in the fallback channel instead.',
      });

      await interaction.editReply(
        result.deliveredVia === 'dm'
          ? `DM sent to <@${member.id}>.`
          : result.deliveredVia === 'fallback'
            ? `That user has DMs closed, so I posted the message in the fallback channel instead.`
            : 'I could not deliver that message by DM or fallback channel.',
      );
    } catch (error) {
      console.error('DM send failed:', error);
      await interaction.editReply('I could not send that DM or fallback notification.');
    }
  },
};
