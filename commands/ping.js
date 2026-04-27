const fs = require('node:fs');
const os = require('node:os');
const packageJson = require('../package.json');
const { EmbedBuilder, MessageFlags, SlashCommandBuilder, version: discordJsVersion } = require('discord.js');

const WS_STATUS_LABELS = {
  0: 'Connecting',
  1: 'Ready',
  2: 'Reconnecting',
  3: 'Idle',
  4: 'Nearly',
  5: 'Disconnected',
};

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) {
    parts.push(`${days}d`);
  }
  if (hours || parts.length) {
    parts.push(`${hours}h`);
  }
  if (minutes || parts.length) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function formatGigabytes(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatPercent(value) {
  return `${Math.max(0, value).toFixed(1)}%`;
}

function formatIntentNames(client) {
  const intentBits = Object.entries(client.options.intents?.bitfield ? client.options.intents.toArray().reduce((acc, bit) => ({ ...acc, [bit]: true }), {}) : {})
    .map(([bit]) => Number(bit))
    .filter(Number.isFinite);

  if (!intentBits.length) {
    return 'Unknown';
  }

  const labels = [];
  for (const [name, value] of Object.entries(require('discord.js').GatewayIntentBits)) {
    if (intentBits.includes(value)) {
      labels.push(name);
    }
  }

  return labels.join(', ') || 'Unknown';
}

function formatPartials(client) {
  const partials = client.options.partials || [];
  if (!partials.length) {
    return 'None';
  }

  const names = Object.entries(require('discord.js').Partials)
    .filter(([, value]) => partials.includes(value))
    .map(([name]) => name);

  return names.join(', ') || 'Unknown';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Show SAVE Assistant bot statistics.'),

  async execute(interaction) {
    const sentAt = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const replyLatency = Date.now() - sentAt;
    const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));
    const uptime = interaction.client.uptime ? formatDuration(interaction.client.uptime) : 'Unknown';
    const startedAtUnix = Math.floor((Date.now() - Math.round(process.uptime() * 1000)) / 1000);
    const guildCount = interaction.client.guilds.cache.size;
    const channelCount = interaction.client.channels.cache.size;
    const userCount = interaction.client.users.cache.size;
    const commandCount = interaction.client.commands?.size || 0;
    const memoryUsage = process.memoryUsage();
    const totalHostMemory = os.totalmem();
    const freeHostMemory = os.freemem();
    const usedHostMemory = totalHostMemory - freeHostMemory;
    const nodeVersion = process.version;
    const processId = process.pid;
    const hostUptime = formatDuration(os.uptime() * 1000);
    const readyAtUnix = interaction.client.readyTimestamp ? Math.floor(interaction.client.readyTimestamp / 1000) : null;
    const wsStatus = WS_STATUS_LABELS[interaction.client.ws.status] || `Unknown (${interaction.client.ws.status})`;
    const botVersion = packageJson.version || 'Unknown';
    const hostname = os.hostname();
    const platform = `${os.platform()} ${os.arch()}`;
    const cpuModel = os.cpus()?.[0]?.model || 'Unknown';
    const cpuThreads = os.availableParallelism ? os.availableParallelism() : os.cpus()?.length || 0;
    const intents = formatIntentNames(interaction.client);
    const partials = formatPartials(interaction.client);
    const botMemoryShare = totalHostMemory > 0 ? (memoryUsage.rss / totalHostMemory) * 100 : 0;
    let diskLine = 'Unavailable';

    try {
      const stat = fs.statfsSync(process.cwd());
      const totalDisk = stat.blocks * stat.bsize;
      const freeDisk = stat.bfree * stat.bsize;
      diskLine = `${formatGigabytes(totalDisk - freeDisk)} used / ${formatGigabytes(totalDisk)} total`;
    } catch {
      diskLine = 'Unavailable';
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('SAVE Assistant Statistics')
      .setDescription('Live bot health, latency, and runtime statistics.')
      .addFields(
        {
          name: 'Latency',
          value: [
            `**Reply:** ${replyLatency}ms`,
            `**Gateway:** ${apiLatency}ms`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Runtime',
          value: [
            `**Bot Uptime:** ${uptime}`,
            `**Started:** <t:${startedAtUnix}:F>`,
            `**Started:** <t:${startedAtUnix}:R>`,
            ...(readyAtUnix ? [`**Ready Since:** <t:${readyAtUnix}:R>`] : []),
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Coverage',
          value: [
            `**Servers:** ${guildCount}`,
            `**Channels:** ${channelCount}`,
            `**Cached Users:** ${userCount}`,
            `**Commands:** ${commandCount}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Process',
          value: [
            `**PID:** ${processId}`,
            `**Node:** ${nodeVersion}`,
            `**discord.js:** v${discordJsVersion}`,
            `**Bot Version:** v${botVersion}`,
            `**Host Uptime:** ${hostUptime}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Memory',
          value: [
            `**RSS:** ${formatMegabytes(memoryUsage.rss)}`,
            `**Heap Used:** ${formatMegabytes(memoryUsage.heapUsed)}`,
            `**Heap Total:** ${formatMegabytes(memoryUsage.heapTotal)}`,
            `**External:** ${formatMegabytes(memoryUsage.external)}`,
            `**Bot Share:** ${formatPercent(botMemoryShare)}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Host Resources',
          value: [
            `**Host RAM:** ${formatGigabytes(usedHostMemory)} used / ${formatGigabytes(totalHostMemory)} total`,
            `**Free RAM:** ${formatGigabytes(freeHostMemory)}`,
            `**Disk:** ${diskLine}`,
            `**CPU Threads:** ${cpuThreads}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Diagnostics',
          value: [
            `**WS Status:** ${wsStatus}`,
            `**Host:** ${hostname}`,
            `**Platform:** ${platform}`,
            `**CPU:** ${cpuModel.slice(0, 32)}`,
            `**Intents:** ${intents}`,
            `**Partials:** ${partials}`,
          ].join('\n'),
          inline: true,
        },
      )
      .setFooter({ text: 'SAVE Assistant Ping' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
