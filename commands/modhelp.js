const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const CATEGORY_ORDER = [
  {
    title: 'Moderation',
    commands: ['warning', 'infraction', 'mute', 'unmute', 'kick', 'ban', 'purge', 'termination'],
  },
  {
    title: 'Management Panels',
    commands: ['patrolmanage', 'arrestmanage', 'manageuser', 'ticketsetup', 'deploymentpanel'],
  },
  {
    title: 'Tracker And Personnel',
    commands: ['patrol', 'arrest', 'quotacheck', 'promotion', 'demotion', 'commendation', 'statement'],
  },
  {
    title: 'Utility',
    commands: ['dm', 'ping', 'info', 'documents', 'interviewquestions'],
  },
  {
    title: 'Operations',
    commands: ['announcement', 'operation', 'meeting', 'training'],
  },
];

function getCommandDescription(collection, commandName) {
  const command = collection.get(commandName);
  return command?.data?.description || 'No description available.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modhelp')
    .setDescription('Show the main moderator and SAVE command tools.'),

  async execute(interaction) {
    const commands = interaction.client.commands;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('SAVE Moderator Help')
      .setDescription('These are the main moderator and management commands currently available.')
      .setFooter({ text: 'SAVE Assistant' })
      .setTimestamp();

    for (const category of CATEGORY_ORDER) {
      const lines = category.commands
        .filter((commandName) => commands.has(commandName))
        .map((commandName) => `• \`/${commandName}\` — ${getCommandDescription(commands, commandName)}`);

      if (lines.length) {
        embed.addFields({
          name: category.title,
          value: lines.join('\n'),
        });
      }
    }

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
