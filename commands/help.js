const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { PERSONNEL_ROLE_COMMANDS } = require('../lib/command-access');

const CATEGORY_ORDER = [
  {
    title: 'SAVE Personnel Commands',
    commands: ['patrol', 'arrest', 'loarequest'],
  },
  {
    title: 'Open Utility Commands',
    commands: ['verify', 'rlookup', 'dmapplication', 'noping', 'help'],
  },
];

function getCommandDescription(collection, commandName) {
  const command = collection.get(commandName);
  return command?.data?.description || 'No description available.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the commands available to SAVE personnel.'),

  async execute(interaction) {
    const commands = interaction.client.commands;

    const availableCommandNames = new Set(
      [...commands.values()]
        .filter((command) => command.allowWithoutRole || PERSONNEL_ROLE_COMMANDS.has(command.data.name))
        .map((command) => command.data.name),
    );

    const embed = new EmbedBuilder()
      .setColor(0x6b7c93)
      .setTitle('SAVE Personnel Help')
      .setDescription('These are the commands available to SAVE personnel and general-use commands you can access.')
      .setFooter({ text: 'SAVE Assistant' })
      .setTimestamp();

    for (const category of CATEGORY_ORDER) {
      const lines = category.commands
        .filter((commandName) => availableCommandNames.has(commandName))
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
