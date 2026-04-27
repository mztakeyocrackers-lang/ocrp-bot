const { SlashCommandBuilder } = require('discord.js');
const { postInfoTemplate } = require('../lib/info-panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('interviewquestions')
    .setDescription('Post the SAVE interview question set.'),

  async execute(interaction) {
    await postInfoTemplate(interaction, 'interview_questions', 'Interview questions sent.');
  },
};
