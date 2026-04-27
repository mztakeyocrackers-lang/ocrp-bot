const { SlashCommandBuilder } = require('discord.js');
const { sendStyledPost } = require('../lib/post-utils');

function quoteLines(text) {
  return String(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => `> ${line.trim() || ' '}`)
    .join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statement')
    .setDescription('Send a premade internal affairs statement.')
    .addStringOption((option) =>
      option
        .setName('rules_broken')
        .setDescription('List the rules that were broken.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('exhibit_1')
        .setDescription('Paste the link for Exhibit 1.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('exhibit_2')
        .setDescription('Paste the link for Exhibit 2.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('exhibit_3')
        .setDescription('Paste the link for Exhibit 3.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('exhibit_4')
        .setDescription('Paste the link for Exhibit 4.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('exhibit_5')
        .setDescription('Paste the link for Exhibit 5.')
        .setRequired(false),
    )
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Optional role to ping for this statement.')
        .setRequired(false),
    ),

  async execute(interaction) {
    const rulesBroken = interaction.options.getString('rules_broken', true);
    const exhibit1 = interaction.options.getString('exhibit_1', true);
    const exhibit2 = interaction.options.getString('exhibit_2');
    const exhibit3 = interaction.options.getString('exhibit_3');
    const exhibit4 = interaction.options.getString('exhibit_4');
    const exhibit5 = interaction.options.getString('exhibit_5');
    const selectedRole = interaction.options.getRole('role');
    const exhibits = [exhibit1, exhibit2, exhibit3, exhibit4, exhibit5]
      .filter(Boolean)
      .map((url, index) => `> [EXHIBIT ${index + 1}](${url})`)
      .join('\n');
    const description = [
      '# Statement',
      '',
      '> Answer in detail.',
      '> This is an official statement and you are under investigation.',
      '> All duties must be halted for (SAVE).',
      '',
      '> Violation:',
      quoteLines(rulesBroken),
      '',
      '> Evidence:',
      exhibits,
    ].join('\n');

    await sendStyledPost({
      interaction,
      title: 'Statement',
      color: 0x99aab5,
      selectedRole,
      description,
      successMessage: 'Statement sent.',
      footerText: 'Posted by Internal Affairs',
    });
  },
};
