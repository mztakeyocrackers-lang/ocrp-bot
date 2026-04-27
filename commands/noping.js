const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getNoPingStatus, setNoPingEnabled } = require('../lib/automod');

module.exports = {
  allowWithoutRole: true,
  data: new SlashCommandBuilder()
    .setName('noping')
    .setDescription('Turn protected anti-ping mode on or off for yourself.')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Choose whether anti-ping should be on, off, or just show your status.')
        .setRequired(true)
        .addChoices(
          { name: 'Enable', value: 'enable' },
          { name: 'Disable', value: 'disable' },
          { name: 'Status', value: 'status' },
        ),
    ),

  async execute(interaction) {
    const mode = interaction.options.getString('mode', true);
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    let enabled = getNoPingStatus(guildId, userId);

    if (mode === 'enable') {
      enabled = true;
      setNoPingEnabled(guildId, userId, true);
    } else if (mode === 'disable') {
      enabled = false;
      setNoPingEnabled(guildId, userId, false);
    }

    const embed = new EmbedBuilder()
      .setColor(enabled ? 0x57f287 : 0x6b7280)
      .setTitle('No-Ping Status')
      .setDescription(
        enabled
          ? '> Anti-ping protection is now enabled.\n> Messages that ping you will be removed automatically.'
          : '> Anti-ping protection is currently disabled.\n> Other users can ping you normally.',
      )
      .setFooter({ text: 'SAVE Assistant' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
