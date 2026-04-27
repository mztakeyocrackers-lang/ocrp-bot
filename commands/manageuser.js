const { SlashCommandBuilder } = require('discord.js');
const {
  buildListPayload,
  createManageUserSession,
} = require('../lib/manage-user');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('manageuser')
    .setDescription('Open the SAVE roster user manager for LOA, roster, promotion, and demotion actions.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const session = await createManageUserSession(interaction.user.id);
      await interaction.editReply(buildListPayload(session));
    } catch (error) {
      console.error('User manager failed to open:', error);
      await interaction.editReply(error.message || 'I could not open the user manager right now.');
    }
  },
};
