const { SlashCommandBuilder } = require('discord.js');
const { executeOperationalCommand } = require('../lib/ocrp-records');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('patrol')
    .setDescription('Create an OCRP patrol log record.')
    .addStringOption((option) =>
      option.setName('department').setDescription('The department or division for this patrol.').setRequired(true))
    .addStringOption((option) =>
      option.setName('officer').setDescription('The staff or officer who completed the patrol.').setRequired(true))
    .addStringOption((option) =>
      option.setName('callsign').setDescription('Optional unit callsign.').setRequired(false))
    .addStringOption((option) =>
      option.setName('start_time').setDescription('Shift start time.').setRequired(true))
    .addStringOption((option) =>
      option.setName('end_time').setDescription('Shift end time.').setRequired(true))
    .addStringOption((option) =>
      option.setName('proof_url').setDescription('Proof or VOD link for the patrol.').setRequired(true))
    .addStringOption((option) =>
      option.setName('roblox_username').setDescription('Optional Roblox username tied to this patrol.').setRequired(false))
    .addStringOption((option) =>
      option.setName('roblox_id').setDescription('Optional Roblox ID tied to this patrol.').setRequired(false))
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional patrol notes.').setRequired(false)),

  async execute(interaction) {
    await executeOperationalCommand(interaction, {
      type: 'patrol',
      department: interaction.options.getString('department', true),
      reason: `Patrol shift logged for ${interaction.options.getString('officer', true)}.`,
      notes: interaction.options.getString('notes') || '',
      evidenceUrl: interaction.options.getString('proof_url', true),
      target: {
        name: interaction.options.getString('officer', true),
      },
      roblox: {
        username: interaction.options.getString('roblox_username') || '',
        id: interaction.options.getString('roblox_id') || '',
      },
      metadata: {
        officer_name: interaction.options.getString('officer', true),
        callsign: interaction.options.getString('callsign') || '',
        start_time: interaction.options.getString('start_time', true),
        end_time: interaction.options.getString('end_time', true),
        proof_url: interaction.options.getString('proof_url', true),
      },
    });
  },
};
