const { SlashCommandBuilder } = require('discord.js');
const {
  buildUserListPayload,
  createPatrolManageSession,
} = require('../lib/patrol-manage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('patrolmanage')
    .setDescription('Open the patrol management panel for editing or deleting patrol logs.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const session = await createPatrolManageSession(interaction.user.id);
      await interaction.editReply(buildUserListPayload(session));
    } catch (error) {
      console.error('Patrol manager failed to open:', error);
      await interaction.editReply(error.message || 'I could not open the patrol manager right now.');
    }
  },
};
