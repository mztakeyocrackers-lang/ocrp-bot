const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { fetchQuotaCheckByDiscordId } = require('../lib/patrol-log');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quotacheck')
    .setDescription('Check whether a member has passed patrol quota this week.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Which member do you want to check?')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.options.getUser('member', true);

    try {
      const result = await fetchQuotaCheckByDiscordId(member.id);

      const embed = new EmbedBuilder()
        .setColor(result.passed ? 0x57f287 : 0xed4245)
        .setTitle('Quota Check')
        .setDescription(
          [
            `> **Member:** <@${member.id}>`,
            `> **Roblox Username:** ${result.personnel.roblox_username || 'Unknown'}`,
            `> **Callsign:** ${result.personnel.callsign || 'Unknown'}`,
            `> **Tracked Time:** ${result.totalDuration}`,
            `> **Required Quota:** ${result.quotaDuration}`,
            `> **Status:** ${result.passed ? 'Passed' : 'Not Passed'}`,
            `> **Remaining:** ${result.passed ? '0m' : result.remainingDuration}`,
            '------------------------------',
            `> **Week Window:** <t:${result.weekRange.startUnix}:D> to <t:${result.weekRange.endUnix}:D>`,
            `> **Patrol Logs Counted:** ${result.weeklyLogs.length}`,
          ].join('\n'),
        )
        .setFooter({ text: `Checked by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Quota check failed:', error);
      await interaction.editReply(error.message || 'I could not complete that quota check.');
    }
  },
};
