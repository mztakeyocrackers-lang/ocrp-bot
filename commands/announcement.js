const { SlashCommandBuilder } = require('discord.js');
const { sendStyledPost } = require('../lib/post-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Send a styled post and optionally ping a role.')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Choose the kind of post to send.')
        .setRequired(true)
        .addChoices(
          { name: 'Announcement', value: 'announcement' },
          { name: 'Shout', value: 'shout' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The announcement you want to post.')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Optional role to ping for this post.')
        .setRequired(false),
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type', true);
    const selectedRole = interaction.options.getRole('role');
    const message = interaction.options.getString('message', true);
    const titleMap = {
      announcement: 'Announcement',
      shout: 'Shout',
    };
    const colorMap = {
      announcement: 0x5865f2,
      shout: 0xed4245,
    };

    await sendStyledPost({
      interaction,
      title: titleMap[type] ?? 'Announcement',
      color: colorMap[type] ?? 0x5865f2,
      selectedRole,
      sections: [message],
      successMessage: 'Announcement sent.',
    });
  },
};
