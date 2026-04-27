const { SlashCommandBuilder } = require('discord.js');
const { executeOperationalCommand } = require('../lib/ocrp-records');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arrest')
    .setDescription('Create an OCRP arrest log record.')
    .addStringOption((option) =>
      option.setName('department').setDescription('The department handling the arrest.').setRequired(true))
    .addStringOption((option) =>
      option.setName('suspect_name').setDescription('The suspect or player being arrested.').setRequired(true))
    .addUserOption((option) =>
      option.setName('suspect_user').setDescription('Optional Discord user tied to the suspect.').setRequired(false))
    .addStringOption((option) =>
      option.setName('suspect_roblox_username').setDescription('Optional suspect Roblox username.').setRequired(false))
    .addStringOption((option) =>
      option.setName('suspect_roblox_id').setDescription('Optional suspect Roblox ID.').setRequired(false))
    .addStringOption((option) =>
      option.setName('officer').setDescription('The arresting officer.').setRequired(true))
    .addStringOption((option) =>
      option.setName('charges').setDescription('Charge summary or reason for the arrest.').setRequired(true))
    .addStringOption((option) =>
      option.setName('location').setDescription('Optional arrest location.').setRequired(false))
    .addStringOption((option) =>
      option.setName('evidence_url').setDescription('Optional evidence or report link.').setRequired(false))
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional arrest notes.').setRequired(false)),

  async execute(interaction) {
    const suspectUser = interaction.options.getUser('suspect_user');

    await executeOperationalCommand(interaction, {
      type: 'arrest',
      department: interaction.options.getString('department', true),
      reason: interaction.options.getString('charges', true),
      notes: interaction.options.getString('notes') || '',
      evidenceUrl: interaction.options.getString('evidence_url') || '',
      target: {
        discordId: suspectUser?.id || null,
        discordTag: suspectUser?.tag || null,
        name: interaction.options.getString('suspect_name', true),
      },
      roblox: {
        username: interaction.options.getString('suspect_roblox_username') || '',
        id: interaction.options.getString('suspect_roblox_id') || '',
      },
      metadata: {
        arresting_officer: interaction.options.getString('officer', true),
        charges: interaction.options.getString('charges', true),
        location: interaction.options.getString('location') || '',
      },
    });
  },
};
