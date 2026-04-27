const { SlashCommandBuilder } = require('discord.js');
const { sendStyledPost } = require('../lib/post-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commendation')
    .setDescription('Send a commendation post and optionally ping a role.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who is being recognized?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The commendation message to post.')
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
      title: 'Commendation',
      color: 0xfee75c,
      selectedRole,
      sections: [`Member: <@${member.id}>`, message],
      successMessage: 'Commendation sent.',
    });
  },
};
