const { SlashCommandBuilder } = require('discord.js');
const {
  buildListPayload,
  createArrestManageSession,
} = require('../lib/arrest-manage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arrestmanage')
    .setDescription('Open the arrest management panel for editing or deleting arrest logs.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const session = await createArrestManageSession(interaction.user.id);
      await interaction.editReply(buildListPayload(session));
    } catch (error) {
      console.error('Arrest manager failed to open:', error);
      await interaction.editReply(error.message || 'I could not open the arrest manager right now.');
    }
  },
};
