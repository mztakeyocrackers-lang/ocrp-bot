const { SlashCommandBuilder } = require('discord.js');
const { sendStyledPost } = require('../lib/post-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meeting')
    .setDescription('Send a meeting notice and optionally ping a role.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The meeting notice to post.')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Optional role to ping for this post.')
        .setRequired(false),
    ),

  async execute(interaction) {
    const message = interaction.options.getString('message', true);
    const selectedRole = interaction.options.getRole('role');

    await sendStyledPost({
      interaction,
      title: 'Meeting',
      color: 0x5865f2,
      selectedRole,
      sections: [message],
      successMessage: 'Meeting notice sent.',
    });
  },
};
