require('dotenv').config();

const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { loadGuildConfigCache, syncAllGuildsFromClient, syncGuildFromDiscord, markGuildInactive, validateConfiguredGuilds } = require('./lib/ocrp-guild-config');
const { recordAuditEvent } = require('./lib/ocrp-audit');
const { reportRuntimeHeartbeat, startRuntimeHeartbeat, stopRuntimeHeartbeat } = require('./lib/ocrp-runtime');

const token = process.env.DISCORD_TOKEN;
const COMMAND_FILES = ['patrol.js', 'arrest.js', 'promotion.js', 'demotion.js', 'blacklist.js'];

if (!token) {
  console.error('Missing DISCORD_TOKEN in OCRPBot .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.commands = new Collection();

for (const file of COMMAND_FILES) {
  const commandPath = path.join(__dirname, 'commands', file);
  const command = require(commandPath);

  if (command?.data?.name && typeof command.execute === 'function') {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`Skipping OCRP command file ${file} because it is missing data or execute.`);
  }
}

let runtimeController = null;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`OCRP bot ready as ${readyClient.user.tag}`);

  try {
    await loadGuildConfigCache();
    await syncAllGuildsFromClient(readyClient);
    const health = await validateConfiguredGuilds(readyClient);
    runtimeController = startRuntimeHeartbeat(readyClient);

    await reportRuntimeHeartbeat(readyClient, {
      status: 'online',
      metadata: {
        configuredGuildHealth: health,
      },
    });

    await recordAuditEvent({
      guildId: null,
      actorDiscordId: readyClient.user.id,
      actorTag: readyClient.user.tag,
      action: 'BOT_READY',
      targetType: 'bot',
      targetId: readyClient.user.id,
      summary: `OCRP bot is online in ${readyClient.guilds.cache.size} guild(s).`,
      metadata: {
        guildCount: readyClient.guilds.cache.size,
        commandCount: client.commands.size,
        configuredGuildHealth: health,
      },
    });
  } catch (error) {
    console.error('OCRP bot startup sync failed:', error);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await syncGuildFromDiscord(guild);
    await recordAuditEvent({
      guildId: guild.id,
      actorDiscordId: client.user?.id || null,
      actorTag: client.user?.tag || 'OCRP Bot',
      action: 'GUILD_JOIN',
      targetType: 'guild',
      targetId: guild.id,
      summary: `Bot joined ${guild.name}.`,
      metadata: {
        guildName: guild.name,
        memberCount: guild.memberCount,
      },
    });
  } catch (error) {
    console.error(`Failed to sync joined guild ${guild.id}:`, error);
  }
});

client.on(Events.GuildDelete, async (guild) => {
  try {
    await markGuildInactive(guild);
    await recordAuditEvent({
      guildId: guild.id,
      actorDiscordId: client.user?.id || null,
      actorTag: client.user?.tag || 'OCRP Bot',
      action: 'GUILD_LEAVE',
      targetType: 'guild',
      targetId: guild.id,
      summary: `Bot left ${guild.name}.`,
      metadata: {
        guildName: guild.name,
      },
    });
  } catch (error) {
    console.error(`Failed to mark guild ${guild.id} inactive:`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`OCRP command ${interaction.commandName} failed:`, error);

    const content = error?.message || 'Something went wrong while running that OCRP command.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
      return;
    }

    await interaction.reply({ content, ephemeral: true }).catch(() => null);
  }
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try {
      stopRuntimeHeartbeat(runtimeController);
      if (client.isReady()) {
        await reportRuntimeHeartbeat(client, { status: 'offline' });
      }
    } catch (error) {
      console.error('Failed to send OCRP bot shutdown heartbeat:', error);
    } finally {
      client.destroy();
      process.exit(0);
    }
  });
}

client.login(token);
