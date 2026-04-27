const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  createInfractionRecord,
  sendStrikeLogMessage,
} = require('../lib/tracker-log');

const ELIGIBLE_ROLE_ID = process.env.PATROL_REQUIRED_ROLE_ID || '1465136661016084608';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infraction')
    .setDescription('Issue a SAVE personnel infraction and log it to the tracker.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('The personnel member receiving the infraction.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the infraction.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('your_username')
        .setDescription('The username to show as the issuing supervisor.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('player_username')
        .setDescription('Optional override for the player username shown in the log.')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const selectedUser = interaction.options.getUser('member', true);
    const selectedMember =
      interaction.options.getMember('member')
      || await interaction.guild.members.fetch(selectedUser.id).catch(() => null);
    const reason = interaction.options.getString('reason', true);
    const yourUsername = interaction.options.getString('your_username') || interaction.user.username;

    if (!selectedMember) {
      await interaction.editReply({
        content: 'I could not resolve that server member.',
      });
      return;
    }

    if (ELIGIBLE_ROLE_ID && !selectedMember.roles.cache.has(ELIGIBLE_ROLE_ID)) {
      await interaction.editReply({
        content: 'That member is not in the SAVE patrol role, so they cannot be selected for this infraction command.',
      });
      return;
    }

    try {
      const result = await createInfractionRecord({
        discordUserId: selectedUser.id,
        reason,
        supervisorUsername: yourUsername,
      });

      let deliveryNote = 'The infraction was saved and posted to the tracker log channel.';

      try {
        await sendStrikeLogMessage({
          client: interaction.client,
          channelId: process.env.TRACKER_LOG_CHANNEL_ID,
          strike: result.record,
          personnel: result.personnel,
          strikeCount: result.strikeCount,
          playerUsername: result.playerUsername,
        });
      } catch (error) {
        console.error('Infraction channel delivery failed:', error);
        deliveryNote = 'The infraction was saved to the website tracker, but Discord channel delivery failed.';
      }

      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Infraction Logged')
        .setDescription(deliveryNote)
        .addFields(
          { name: 'Member', value: `<@${selectedUser.id}>`, inline: true },
          { name: 'Callsign', value: result.personnel?.callsign || 'Unknown', inline: true },
          { name: 'Player Username', value: result.playerUsername || 'Unknown', inline: true },
          { name: 'Strike Count', value: String(result.strikeCount || 1), inline: true },
          { name: 'Issued By', value: yourUsername, inline: true },
        )
        .setFooter({ text: 'SAVE Personnel Tracker' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Infraction command failed:', error);
      await interaction.editReply({
        content: error.message || 'Something went wrong while logging that infraction.',
      });
    }
  },
};
