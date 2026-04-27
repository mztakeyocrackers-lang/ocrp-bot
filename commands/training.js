const { SlashCommandBuilder } = require('discord.js');
const { sendStyledPost } = require('../lib/post-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('training')
    .setDescription('Send a training notice and optionally ping a role.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The training notice to post.')
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
      title: 'Training',
      color: 0x3ba55d,
      selectedRole,
      sections: [message],
      successMessage: 'Training notice sent.',
    });
  },
};
