const { SlashCommandBuilder } = require('discord.js');
const { sendStyledPost } = require('../lib/post-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warning')
    .setDescription('Send a warning post and optionally ping a role.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who is receiving the warning?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The warning message to post.')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Optional role to ping for this post.')
        .setRequired(false),
    ),

  async execute(interaction) {
    const member = interaction.options.getUser('member', true);
    const message = interaction.options.getString('message', true);
    const selectedRole = interaction.options.getRole('role');

    await sendStyledPost({
      interaction,
      title: 'Warning',
      color: 0xfaa61a,
      selectedRole,
      sections: [`Member: <@${member.id}>`, message],
      successMessage: 'Warning sent.',
    });
  },
};
