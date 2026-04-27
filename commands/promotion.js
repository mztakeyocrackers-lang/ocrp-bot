const { SlashCommandBuilder } = require('discord.js');
const { executeOperationalCommand } = require('../lib/ocrp-records');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promotion')
    .setDescription('Create an OCRP promotion record.')
    .addStringOption((option) =>
      option.setName('department').setDescription('The department handling the promotion.').setRequired(true))
    .addUserOption((option) =>
      option.setName('member').setDescription('The member being promoted.').setRequired(true))
    .addStringOption((option) =>
      option.setName('new_rank').setDescription('The new rank or title.').setRequired(true))
    .addStringOption((option) =>
      option.setName('roblox_username').setDescription('Optional Roblox username for the promoted member.').setRequired(false))
    .addStringOption((option) =>
      option.setName('roblox_id').setDescription('Optional Roblox ID for the promoted member.').setRequired(false))
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why is this member being promoted?').setRequired(true))
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional promotion notes.').setRequired(false)),

  async execute(interaction) {
    const member = interaction.options.getUser('member', true);

    await executeOperationalCommand(interaction, {
      type: 'promotion',
      department: interaction.options.getString('department', true),
      reason: interaction.options.getString('reason', true),
      notes: interaction.options.getString('notes') || '',
      target: {
        discordId: member.id,
        discordTag: member.tag,
        name: member.username,
      },
      roblox: {
        username: interaction.options.getString('roblox_username') || '',
        id: interaction.options.getString('roblox_id') || '',
      },
      metadata: {
        new_rank: interaction.options.getString('new_rank', true),
      },
    });
  },
};
