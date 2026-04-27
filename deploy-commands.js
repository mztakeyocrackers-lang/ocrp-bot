require('dotenv').config();

const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const COMMAND_FILES = ['patrol.js', 'arrest.js', 'promotion.js', 'demotion.js', 'blacklist.js'];

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in the OCRP bot environment.');
  process.exit(1);
}

const commands = COMMAND_FILES.map((file) => require(`./commands/${file}`))
  .filter((command) => command?.data)
  .map((command) => command.data.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Deploying ${commands.length} OCRP slash command(s)...`);

    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );
      console.log(`OCRP guild commands deployed to ${guildId}.`);
      return;
    }

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );
    console.log('OCRP global commands deployed successfully.');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
