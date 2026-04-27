const { SlashCommandBuilder } = require('discord.js');
const { executeOperationalCommand } = require('../lib/ocrp-records');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Create an OCRP blacklist record.')
    .addStringOption((option) =>
      option.setName('department').setDescription('The department or command unit issuing the blacklist.').setRequired(true))
    .addStringOption((option) =>
      option.setName('subject_name').setDescription('The blacklisted subject name.').setRequired(true))
    .addUserOption((option) =>
      option.setName('subject_user').setDescription('Optional Discord user tied to the subject.').setRequired(false))
    .addStringOption((option) =>
      option.setName('roblox_username').setDescription('Optional Roblox username tied to the subject.').setRequired(false))
    .addStringOption((option) =>
      option.setName('roblox_id').setDescription('Optional Roblox ID tied to the subject.').setRequired(false))
    .addStringOption((option) =>
      option.setName('reason').setDescription('The reason for the blacklist.').setRequired(true))
    .addStringOption((option) =>
      option.setName('duration').setDescription('Optional blacklist duration or status.').setRequired(false))
    .addStringOption((option) =>
      option.setName('evidence_url').setDescription('Optional evidence or case file link.').setRequired(false))
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional blacklist notes.').setRequired(false)),

  async execute(interaction) {
    const subjectUser = interaction.options.getUser('subject_user');

    await executeOperationalCommand(interaction, {
      type: 'blacklist',
      department: interaction.options.getString('department', true),
      reason: interaction.options.getString('reason', true),
      notes: interaction.options.getString('notes') || '',
      evidenceUrl: interaction.options.getString('evidence_url') || '',
      target: {
        discordId: subjectUser?.id || null,
        discordTag: subjectUser?.tag || null,
        name: interaction.options.getString('subject_name', true),
      },
      roblox: {
        username: interaction.options.getString('roblox_username') || '',
        id: interaction.options.getString('roblox_id') || '',
      },
      metadata: {
        duration: interaction.options.getString('duration') || 'Permanent / review required',
      },
    });
  },
};
