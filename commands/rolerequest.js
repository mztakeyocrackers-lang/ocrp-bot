const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  createRoleRequestPanelPayload,
  validateRoleRequestContext,
} = require('../lib/role-request-panel');

module.exports = {
  allowWithoutRole: true,
  data: new SlashCommandBuilder()
    .setName('rolerequest')
    .setDescription('Open the SAVE role request panel.'),

  async execute(interaction) {
    const member =
      interaction.member ??
      (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

    const validationError = await validateRoleRequestContext(interaction, member);
    if (validationError) {
      await interaction.reply({
        content: validationError,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(createRoleRequestPanelPayload());
  },
};
