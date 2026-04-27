const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

const STATE_FILE = path.join(__dirname, '..', 'data', 'automod-state.json');
const AUTOMOD_LOG_CHANNEL_ID = process.env.AUTOMOD_LOG_CHANNEL_ID || '1497415530657611917';

const BLOCKED_PATTERNS = [
  { label: 'Severe slur', regex: /\bnigg(?:a|er|ers|as|uh)?\b/i },
  { label: 'Severe slur', regex: /\bfagg?(?:ot|ots)?\b/i },
  { label: 'Severe slur', regex: /\bretard(?:ed|s)?\b/i },
  { label: 'Severe slur', regex: /\bkike?s?\b/i },
  { label: 'Severe slur', regex: /\bchink(?:s)?\b/i },
  { label: 'Severe slur', regex: /\bspic(?:s)?\b/i },
  { label: 'Severe slur', regex: /\btrann(?:y|ies)\b/i },
  { label: 'Profanity', regex: /\bfuck(?:er|ers|ing|ed|s)?\b/i },
  { label: 'Profanity', regex: /\bmotherfucker(?:s)?\b/i },
  { label: 'Profanity', regex: /\bshit(?:ty|ting|ted|s)?\b/i },
  { label: 'Profanity', regex: /\bbitch(?:es|y)?\b/i },
  { label: 'Profanity', regex: /\bslut(?:s)?\b/i },
  { label: 'Profanity', regex: /\bwhore(?:s)?\b/i },
  { label: 'Profanity', regex: /\bcunt(?:s)?\b/i },
  { label: 'Profanity', regex: /\basshole(?:s)?\b/i },
  { label: 'Profanity', regex: /\bdickhead(?:s)?\b/i },
  { label: 'Profanity', regex: /\bdumbass(?:es)?\b/i },
];

function ensureStateDir() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

function loadState() {
  ensureStateDir();

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      noPingByGuild: parsed?.noPingByGuild && typeof parsed.noPingByGuild === 'object' ? parsed.noPingByGuild : {},
      warningsByGuild: parsed?.warningsByGuild && typeof parsed.warningsByGuild === 'object' ? parsed.warningsByGuild : {},
    };
  } catch {
    return {
      noPingByGuild: {},
      warningsByGuild: {},
    };
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function getGuildNoPingSet(state, guildId) {
  const values = Array.isArray(state.noPingByGuild[guildId]) ? state.noPingByGuild[guildId] : [];
  return new Set(values.filter(Boolean));
}

function setNoPingEnabled(guildId, userId, enabled) {
  const state = loadState();
  const current = getGuildNoPingSet(state, guildId);

  if (enabled) {
    current.add(userId);
  } else {
    current.delete(userId);
  }

  state.noPingByGuild[guildId] = Array.from(current);
  saveState(state);

  return {
    enabled,
    protectedCount: state.noPingByGuild[guildId].length,
  };
}

function getNoPingStatus(guildId, userId) {
  const state = loadState();
  return getGuildNoPingSet(state, guildId).has(userId);
}

function incrementWarningCount(guildId, userId) {
  const state = loadState();
  if (!state.warningsByGuild[guildId]) {
    state.warningsByGuild[guildId] = {};
  }

  const nextCount = (Number(state.warningsByGuild[guildId][userId]) || 0) + 1;
  state.warningsByGuild[guildId][userId] = nextCount;
  saveState(state);
  return nextCount;
}

function normalizeForDetection(content) {
  const charMap = {
    '@': 'a',
    '4': 'a',
    '8': 'b',
    '3': 'e',
    '6': 'g',
    '1': 'i',
    '!': 'i',
    '|': 'i',
    '0': 'o',
    '$': 's',
    '5': 's',
    '7': 't',
  };

  return String(content || '')
    .toLowerCase()
    .split('')
    .map((character) => {
      if (charMap[character]) {
        return charMap[character];
      }

      if (/[a-z0-9\s]/.test(character)) {
        return character;
      }

      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectBlockedContent(content) {
  const normalized = normalizeForDetection(content);
  if (!normalized) {
    return null;
  }

  const matches = BLOCKED_PATTERNS.filter((pattern) => pattern.regex.test(normalized));
  if (!matches.length) {
    return null;
  }

  const severe = matches.some((match) => match.label === 'Severe slur');
  return {
    type: severe ? 'slur' : 'profanity',
    label: severe ? 'Blocked slur or hate speech' : 'Blocked profanity',
  };
}

async function sendDirectWarning(user, embed) {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

async function deleteMessageSafely(message) {
  try {
    if (message.deletable) {
      await message.delete();
      return true;
    }
  } catch {}

  return false;
}

function buildWarningEmbed({ title, description, warningCount }) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(title)
    .setDescription(description)
    .addFields({
      name: 'Automod Warning Count',
      value: String(warningCount),
      inline: true,
    })
    .setFooter({ text: 'SAVE Assistant Automod' })
    .setTimestamp();
}

function truncate(value, maxLength = 1000) {
  const text = String(value ?? '').trim();
  if (!text) {
    return 'None';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function resolveAutomodLogChannel(client) {
  const channel = client.channels.cache.get(AUTOMOD_LOG_CHANNEL_ID)
    || await client.channels.fetch(AUTOMOD_LOG_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

async function sendAutomodLog(client, {
  message,
  reason,
  warningCount,
  targets = [],
}) {
  const channel = await resolveAutomodLogChannel(client);
  if (!channel) {
    return false;
  }

  const targetLine = targets.length
    ? targets.map((user) => `<@${user.id}>`).join(', ')
    : 'None';

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Automod Action')
    .setDescription(`A message from <@${message.author.id}> was removed automatically.`)
    .addFields(
      { name: 'User', value: `<@${message.author.id}>`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Reason', value: reason, inline: true },
      { name: 'Protected Targets', value: targetLine, inline: false },
      { name: 'Message Content', value: truncate(message.content, 1000), inline: false },
      { name: 'Warning Count', value: String(warningCount), inline: true },
    )
    .setFooter({ text: `User ID: ${message.author.id} | Message ID: ${message.id}` })
    .setTimestamp();

  await channel.send({
    content: `<@${message.author.id}>`,
    embeds: [embed],
    allowedMentions: {
      parse: [],
      users: [message.author.id],
      roles: [],
    },
  });

  return true;
}

async function handleAutomodMessage(client, message) {
  if (!message?.guild || !message.author || message.author.bot) {
    return false;
  }

  const content = String(message.content || '');
  if (!content && !message.mentions?.users?.size) {
    return false;
  }

  const blocked = detectBlockedContent(content);
  if (blocked) {
    await deleteMessageSafely(message);
    const warningCount = incrementWarningCount(message.guild.id, message.author.id);
    await sendAutomodLog(client, {
      message,
      reason: blocked.label,
      warningCount,
    });
    await sendDirectWarning(
      message.author,
      buildWarningEmbed({
        title: 'Automod Warning',
        description: `Your message in **${message.guild.name}** was removed for ${blocked.label.toLowerCase()}.`,
        warningCount,
      }),
    );
    return true;
  }

  if (message.mentions?.users?.size) {
    const state = loadState();
    const protectedUsers = getGuildNoPingSet(state, message.guild.id);
    const violatedTargets = message.mentions.users.filter((user) => protectedUsers.has(user.id) && user.id !== message.author.id);

    if (violatedTargets.size) {
      await deleteMessageSafely(message);
      const warningCount = incrementWarningCount(message.guild.id, message.author.id);
      const targets = violatedTargets.map((user) => `<@${user.id}>`).join(', ');
      await sendAutomodLog(client, {
        message,
        reason: 'Pinged a protected no-ping user',
        warningCount,
        targets: Array.from(violatedTargets.values()),
      });

      await sendDirectWarning(
        message.author,
        buildWarningEmbed({
          title: 'Automod Warning',
          description: `Your message in **${message.guild.name}** was removed because you pinged a protected user: ${targets}.`,
          warningCount,
        }),
      );
      return true;
    }
  }

  return false;
}

module.exports = {
  getNoPingStatus,
  handleAutomodMessage,
  setNoPingEnabled,
};
