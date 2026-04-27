const { SlashCommandBuilder } = require('discord.js');
const { executeOperationalCommand } = require('../lib/ocrp-records');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demotion')
    .setDescription('Create an OCRP demotion record.')
    .addStringOption((option) =>
      option.setName('department').setDescription('The department handling the demotion.').setRequired(true))
    .addUserOption((option) =>
      option.setName('member').setDescription('The member being demoted.').setRequired(true))
    .addStringOption((option) =>
      option.setName('previous_rank').setDescription('Optional previous rank or title.').setRequired(false))
    .addStringOption((option) =>
      option.setName('roblox_username').setDescription('Optional Roblox username for the demoted member.').setRequired(false))
    .addStringOption((option) =>
      option.setName('roblox_id').setDescription('Optional Roblox ID for the demoted member.').setRequired(false))
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why is this member being demoted?').setRequired(true))
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional demotion notes.').setRequired(false)),

  async execute(interaction) {
    const member = interaction.options.getUser('member', true);

    await executeOperationalCommand(interaction, {
      type: 'demotion',
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
        previous_rank: interaction.options.getString('previous_rank') || '',
      },
    });
  },
};
