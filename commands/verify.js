const { SlashCommandBuilder } = require('discord.js');
const {
  VERIFY_BASE_URL,
  buildVerifyPrompt,
  createVerificationSession,
} = require('../lib/roblox-verify');

module.exports = {
  allowWithoutRole: true,
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Roblox account and receive the verified role.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.inGuild()) {
      await interaction.editReply('This command only works inside the server.');
      return;
    }

    if (!VERIFY_BASE_URL) {
      await interaction.editReply(
        'Roblox verification is not configured yet. Set `ROBLOX_VERIFY_BASE_URL` before using `/verify`.',
      );
      return;
    }

    const session = await createVerificationSession({
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.tag,
      guildId: interaction.guildId,
    });

    const { embed, row } = buildVerifyPrompt({ url: session.url });

    await interaction.editReply({
      content: 'Open the button below to continue your Roblox verification.',
      embeds: [embed],
      components: [row],
    });
  },
};
