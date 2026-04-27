const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  OverwriteType,
  PermissionsBitField,
} = require('discord.js');

const memberEventDebugLog = path.join(__dirname, '..', 'logs', 'member-events.log');
const joinBannerUrl = 'https://www.image2url.com/r2/default/images/1777166683228-5bc90669-8669-490a-805d-2a0a92a04811.png';
const verifyChannelUrl = 'https://discord.com/channels/1465136660533612798/1465136662714519723';
const rulesChannelUrl = 'https://discord.com/channels/1465136660533612798/1465136662949658675';
const saveInfoChannelUrl = 'https://discord.com/channels/1465136660533612798/1467024034414985439';
const applicationsChannelUrl = 'https://discord.com/channels/1465136660533612798/1480050430560960563';

function writeMemberEventDebug(line) {
  try {
    fs.mkdirSync(path.dirname(memberEventDebugLog), { recursive: true });
    fs.appendFileSync(memberEventDebugLog, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // Ignore debug logging failures.
  }
}

function toDisplay(value, fallback = 'Unknown') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function truncate(value, max = 900) {
  const text = toDisplay(value, '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text || 'None';
}

function formatDeletedMessageContent(content, max = 950) {
  const normalized = String(content ?? '').trim();
  if (!normalized) return 'None';
  if (normalized.length > max) return 'TOO LARGE';
  return normalized;
}

function formatChannel(channel) {
  if (!channel) return 'Unknown channel';
  if (typeof channel.toString === 'function') {
    return channel.toString();
  }
  return `#${channel.name || channel.id || 'unknown-channel'}`;
}

function formatChannelLabel(channel) {
  return `#${channel?.name || channel?.id || 'unknown-channel'}`;
}

function formatRole(role) {
  if (!role) return 'Unknown role';
  return role.id ? `<@&${role.id}>` : role.name;
}

function mentionById(id) {
  return id ? `<@${id}>` : null;
}

function formatUser(user) {
  if (!user) return 'Unknown user';
  const mention = mentionById(user.id);
  const label = `${user.tag || user.username || 'Unknown'} (${user.id || 'Unknown ID'})`;
  return mention ? `${mention} | ${label}` : label;
}

function formatPlainUser(user) {
  if (!user) return 'Unknown';
  const name = user.tag
    || user.username
    || user.globalName
    || user.user?.tag
    || user.user?.username
    || user.displayName
    || 'Unknown';
  const id = user.id || user.user?.id || 'Unknown ID';
  return `${name} (${id})`;
}

function formatMember(member) {
  if (!member) return 'Unknown member';
  const mention = mentionById(member.id);
  const label = `${member.user?.tag || member.user?.username || member.displayName || 'Unknown'} (${member.id || 'Unknown ID'})`;
  return mention ? `${mention} | ${label}` : label;
}

function formatCompactUser(user) {
  if (!user) return 'Unknown user';
  return user.globalName || user.username || user.tag || 'Unknown user';
}

function formatExecutorName(executor) {
  if (!executor) return 'Unknown';
  return executor.tag
    || executor.username
    || executor.globalName
    || executor.user?.tag
    || executor.user?.username
    || executor.displayName
    || executor.id
    || 'Unknown';
}

function formatExecutorLabel(executor) {
  if (!executor) return 'Unknown';
  return formatPlainUser(executor);
}

function getSafeUserAvatar(user) {
  return user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || undefined;
}

function getSafeExecutorAvatar(executor) {
  return executor?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || executor?.user?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || undefined;
}

function getSafeMemberDisplayName(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || member?.user?.tag || 'Unknown Member';
}

function getSafeMemberUsername(member) {
  return member?.user?.username || member?.user?.tag || '';
}

function getSafeMemberAvatar(member) {
  return member?.user?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || member?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || undefined;
}

function getSafeUnixTimestamp(value) {
  const timestamp = Math.floor(Number(value || 0) / 1000);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function formatMessageAuthor(message) {
  if (!message) return 'Unknown author';
  if (message.author) {
    return formatUser(message.author);
  }
  if (message.member) {
    return formatMember(message.member);
  }
  return 'Unknown author';
}

function formatChannelType(type) {
  const map = {
    [ChannelType.GuildText]: 'Text',
    [ChannelType.GuildVoice]: 'Voice',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.GuildStageVoice]: 'Stage',
    [ChannelType.GuildDirectory]: 'Directory',
    [ChannelType.GuildMedia]: 'Media',
  };
  return map[type] || `Type ${type}`;
}

function formatPermissionName(name) {
  return String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bTTS\b/g, 'TTS')
    .replace(/\bVAD\b/g, 'VAD')
    .trim();
}

function formatPermissionState(state) {
  if (state === 'allow') return 'Allow';
  if (state === 'deny') return 'Deny';
  return 'Neutral';
}

function getOverwritePermissionState(overwrite, permission) {
  if (!overwrite) return 'neutral';
  if (overwrite.allow.has(permission)) return 'allow';
  if (overwrite.deny.has(permission)) return 'deny';
  return 'neutral';
}

function formatOverwriteTarget(channel, overwrite) {
  if (!channel || !overwrite) return 'Unknown target';

  if (overwrite.type === OverwriteType.Role) {
    const role = channel.guild.roles.cache.get(overwrite.id);
    return role ? formatRole(role) : `<@&${overwrite.id}>`;
  }

  const member = channel.guild.members.cache.get(overwrite.id);
  return member ? formatMember(member) : (mentionById(overwrite.id) || overwrite.id);
}

function summarizeOverwritePermissions(overwrite) {
  if (!overwrite) return 'No explicit permissions.';

  const changes = [];

  for (const permission of Object.keys(PermissionsBitField.Flags)) {
    const state = getOverwritePermissionState(overwrite, permission);
    if (state === 'neutral') continue;
    changes.push(`â€¢ ${formatPermissionName(permission)}: ${formatPermissionState(state)}`);
  }

  if (!changes.length) {
    return 'No explicit permissions.';
  }

  const preview = changes.slice(0, 6).join('\n');
  return changes.length > 6
    ? `${preview}\nâ€¢ +${changes.length - 6} more permission setting(s)`
    : preview;
}

function collectChannelOverwriteChanges(oldChannel, newChannel) {
  const oldOverwrites = oldChannel.permissionOverwrites?.cache || new Map();
  const newOverwrites = newChannel.permissionOverwrites?.cache || new Map();
  const overwriteIds = new Set([
    ...oldOverwrites.keys(),
    ...newOverwrites.keys(),
  ]);

  const changes = [];

  for (const overwriteId of overwriteIds) {
    const oldOverwrite = oldOverwrites.get(overwriteId);
    const newOverwrite = newOverwrites.get(overwriteId);

    if (!oldOverwrite && newOverwrite) {
      changes.push(
        `Permissions added for ${formatOverwriteTarget(newChannel, newOverwrite)}:\n${summarizeOverwritePermissions(newOverwrite)}`,
      );
      continue;
    }

    if (oldOverwrite && !newOverwrite) {
      changes.push(`Permissions removed for ${formatOverwriteTarget(oldChannel, oldOverwrite)}`);
      continue;
    }

    if (!oldOverwrite || !newOverwrite) continue;

    const permissionDiffs = [];

    for (const permission of Object.keys(PermissionsBitField.Flags)) {
      const beforeState = getOverwritePermissionState(oldOverwrite, permission);
      const afterState = getOverwritePermissionState(newOverwrite, permission);

      if (beforeState === afterState) continue;

      permissionDiffs.push(
        `â€¢ ${formatPermissionName(permission)}: ${formatPermissionState(beforeState)} -> ${formatPermissionState(afterState)}`,
      );
    }

    if (!permissionDiffs.length) continue;

    const preview = permissionDiffs.slice(0, 6).join('\n');
    const summary = permissionDiffs.length > 6
      ? `${preview}\nâ€¢ +${permissionDiffs.length - 6} more permission change(s)`
      : preview;

    changes.push(`Permissions changed for ${formatOverwriteTarget(newChannel, newOverwrite)}:\n${summary}`);
  }

  if (changes.length <= 4) {
    return changes;
  }

  return [
    ...changes.slice(0, 4),
    `+${changes.length - 4} more overwrite target(s) changed`,
  ];
}

function buildChannelUpdateDescription(newChannel, changes) {
  const channelLine = `${formatChannel(newChannel)} was changed:`;
  const body = changes
    .filter(Boolean)
    .map((change) => String(change).trim())
    .join('\n\n');

  return [channelLine, body].filter(Boolean).join('\n\n');
}

function buildStackedChangeEmbed({
  title,
  color,
  subjectLine,
  sections = [],
  footerId,
}) {
  const body = sections
    .filter(Boolean)
    .map((section) => String(section).trim())
    .filter(Boolean)
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription([subjectLine, body].filter(Boolean).join('\n\n'))
    .setTimestamp();

  if (footerId) {
    embed.setFooter({ text: `ID: ${footerId}` });
  }

  return embed;
}

function buildExecutorActionEmbed({
  title,
  color,
  executor,
  subjectLine,
  details = [],
  footerId,
}) {
  const descriptionLines = [subjectLine].filter(Boolean);
  const trimmedDetails = details
    .filter(Boolean)
    .map((detail) => String(detail).trim())
    .filter(Boolean);

  if (trimmedDetails.length) {
    descriptionLines.push('', ...trimmedDetails);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(descriptionLines.join('\n'))
    .setTimestamp();

  const executorName = formatExecutorName(executor);
  const executorLabel = formatExecutorLabel(executor);

  if (executor && executorName !== 'Unknown') {
    embed.setAuthor({
      name: executorName,
      iconURL: getSafeExecutorAvatar(executor),
    });
  }

  embed.setFooter({
    text: footerId
      ? `ID: ${footerId}${executorLabel !== 'Unknown' ? ` | Executor: ${executorLabel}` : ''}`
      : `ID: Unknown${executorLabel !== 'Unknown' ? ` | Executor: ${executorLabel}` : ''}`,
  });

  return embed;
}

function buildExecutorDynoEmbed({
  title,
  color,
  executor,
  headline,
  bodyLines = [],
  footerId,
}) {
  const body = bodyLines
    .filter(Boolean)
    .map((line) => String(line).trim())
    .filter(Boolean)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription([
      `**${headline}**`,
      body,
    ].filter(Boolean).join('\n'))
    .setTimestamp();

  const executorName = formatExecutorName(executor);
  const executorLabel = formatExecutorLabel(executor);

  if (executor && executorName !== 'Unknown') {
    embed.setAuthor({
      name: executorName,
      iconURL: getSafeExecutorAvatar(executor),
    });
  }

  embed.setFooter({
    text: footerId
      ? `ID: ${footerId}${executorLabel !== 'Unknown' ? ` | Executor: ${executorLabel}` : ''}`
      : `ID: Unknown${executorLabel !== 'Unknown' ? ` | Executor: ${executorLabel}` : ''}`,
  });

  return embed;
}

function formatAttachments(attachments) {
  if (!attachments?.size) return 'None';

  return [...attachments.values()]
    .slice(0, 6)
    .map((attachment) => {
      const label = attachment.name || 'attachment';
      return `[${label}](${attachment.url})`;
    })
    .join('\n');
}

function snapshotMessage(message) {
  if (!message?.id) return null;

  const attachments = message.attachments?.size
    ? [...message.attachments.values()].slice(0, 6).map((attachment) => ({
      name: attachment.name || 'attachment',
      url: attachment.url,
    }))
    : [];

  return {
    id: message.id,
    content: String(message.content ?? ''),
    channelId: message.channel?.id || null,
    channelName: message.channel?.name || null,
    guildId: message.guild?.id || null,
    authorId: message.author?.id || message.member?.id || null,
    authorTag: message.author?.tag || message.author?.username || message.member?.displayName || 'Unknown',
    authorAvatarUrl: message.author?.displayAvatarURL?.() || null,
    attachments,
    createdTimestamp: Date.now(),
  };
}

function formatSnapshotAuthor(snapshot) {
  if (!snapshot) return 'Unknown author';
  const mention = mentionById(snapshot.authorId);
  const label = `${snapshot.authorTag || 'Unknown'} (${snapshot.authorId || 'Unknown ID'})`;
  return mention ? `${mention} | ${label}` : label;
}

function formatSnapshotChannel(snapshot, fallbackChannel) {
  if (fallbackChannel) {
    return formatChannel(fallbackChannel);
  }
  if (!snapshot) {
    return 'Unknown channel';
  }
  const mention = snapshot.channelId ? `<#${snapshot.channelId}>` : null;
  const label = `${snapshot.channelName || 'Unknown channel'} (${snapshot.channelId || 'Unknown ID'})`;
  return mention ? `${mention} | ${label}` : label;
}

function formatSnapshotAttachments(snapshot) {
  if (!snapshot?.attachments?.length) return 'None';
  return snapshot.attachments
    .map((attachment) => `[${attachment.name}](${attachment.url})`)
    .join('\n');
}

function formatSnapshotChannelMention(snapshot, fallbackChannel) {
  const channelId = fallbackChannel?.id || snapshot?.channelId || null;
  const channelName = fallbackChannel?.name || snapshot?.channelName || 'Unknown channel';
  const mention = channelId ? `<#${channelId}>` : null;
  return mention || `# ${channelName}`;
}

async function fetchAuditEntry(guild, action, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: action, limit: 6 });
    return logs.entries.find((candidate) => {
      if (!candidate) return false;
      const sameTarget = String(candidate.target?.id || '') === String(targetId || '');
      const freshEnough = Date.now() - candidate.createdTimestamp < 15000;
      return sameTarget && freshEnough;
    });
  } catch {
    return null;
  }
}

async function fetchExecutor(guild, action, targetId) {
  const entry = await fetchAuditEntry(guild, action, targetId);
  return entry?.executor || null;
}

function buildLogEmbed({ title, color, description, fields }) {
  const compactLines = [];

  if (description) {
    compactLines.push(description);
  }

  for (const field of fields.filter(Boolean)) {
    const value = truncate(field.value, 1024);
    compactLines.push(`**${field.name}:** ${value}`);
  }

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: title })
    .setDescription(compactLines.join('\n'))
    .setTimestamp();
}

async function sendLog(client, channelId, payload) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send(payload).catch((error) => {
    console.error('Server log send failed:', error);
  });
}

async function sendLeaveLog(client, channelId, member) {
  writeMemberEventDebug(`sendLeaveLog:start member=${member?.id || 'unknown'} channel=${channelId || 'missing'}`);

  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    writeMemberEventDebug(`sendLeaveLog:no-channel member=${member?.id || 'unknown'} channel=${channelId || 'missing'}`);
    return false;
  }

  const avatarUrl = getSafeMemberAvatar(member);
  const leaveEmbed = new EmbedBuilder()
    .setColor(0xed4245)
    .setAuthor({
      name: 'Member Left',
      iconURL: avatarUrl || undefined,
    })
    .setDescription(`${mentionById(member?.id) || 'A member'} left the server.`)
    .setFooter({ text: `User ID: ${member?.id || 'Unknown'}` })
    .setTimestamp();

  try {
    await channel.send({ embeds: [leaveEmbed] });
    writeMemberEventDebug(`sendLeaveLog:embed-success member=${member?.id || 'unknown'}`);
    return true;
  } catch (error) {
    writeMemberEventDebug(`sendLeaveLog:embed-failed member=${member?.id || 'unknown'} error=${error?.message || error}`);
    console.error('Leave embed send failed:', error);
  }

  try {
    await channel.send({
      content: `Member left the server.\nUser ID: ${member?.id || 'Unknown'}`,
    });
    writeMemberEventDebug(`sendLeaveLog:text-success member=${member?.id || 'unknown'}`);
    return true;
  } catch (error) {
    writeMemberEventDebug(`sendLeaveLog:text-failed member=${member?.id || 'unknown'} error=${error?.message || error}`);
    console.error('Leave text fallback failed:', error);
  }

  return false;
}

async function sendLeaveAlert(client, channelId, alertRoleId, member) {
  if (!channelId || !alertRoleId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  try {
    await channel.send({
      content: `<@&${alertRoleId}> A member of (SAVE) has left. ${mentionById(member?.id) || ''}`.trim(),
      allowedMentions: {
        roles: [alertRoleId],
        users: member?.id ? [member.id] : [],
      },
    });
    writeMemberEventDebug(`sendLeaveAlert:success member=${member?.id || 'unknown'} alertRole=${alertRoleId}`);
    return true;
  } catch (error) {
    writeMemberEventDebug(`sendLeaveAlert:failed member=${member?.id || 'unknown'} error=${error?.message || error}`);
    console.error('Leave alert send failed:', error);
    return false;
  }
}

function buildMemberLifecycleEmbed({
  title,
  color,
  member,
  lines = [],
}) {
  const avatarUrl = getSafeMemberAvatar(member);
  const displayName = getSafeMemberDisplayName(member);
  const username = getSafeMemberUsername(member);
  const cleanUsername = username ? `@${username.replace(/^@+/, '')}` : null;
  const sameName = cleanUsername && displayName
    ? cleanUsername.toLowerCase() === `@${String(displayName).replace(/^@+/, '').toLowerCase()}`
    : false;
  const authorText = sameName || !cleanUsername
    ? toDisplay(displayName, 'Unknown Member')
    : `${toDisplay(displayName, 'Unknown Member')} (${cleanUsername})`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(toDisplay(title, 'Member Activity'))
    .setDescription(
      lines
        .filter(Boolean)
        .map((line) => String(line).trim())
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: `User ID: ${member?.id || 'Unknown'}` })
    .setTimestamp();

  if (authorText) {
    embed.setAuthor({
      name: authorText,
      iconURL: avatarUrl || undefined,
    });
  }

  if (lines.length) {
    embed.setDescription([
      ...lines,
    ].join('\n'));
  }

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return embed;
}

function buildJoinLines(member) {
  const createdTimestamp = getSafeUnixTimestamp(member?.user?.createdTimestamp);
  const joinedTimestamp = getSafeUnixTimestamp(Date.now());

  return [
    `${mentionById(member?.id) || 'A new member'} joined the server.`,
    '',
    '**Account Age**',
    createdTimestamp ? `<t:${createdTimestamp}:F>` : 'Unknown',
    createdTimestamp ? `<t:${createdTimestamp}:R>` : 'Unknown',
    '',
    '**Joined Server**',
    joinedTimestamp ? `<t:${joinedTimestamp}:F>` : 'Unknown',
    joinedTimestamp ? `<t:${joinedTimestamp}:R>` : 'Unknown',
  ];
}

function buildLeaveLines(member) {
  return [
    `${mentionById(member?.id) || 'A member'} left the server.`,
  ];
}

function buildJoinEmbed(member) {
  const avatarUrl = getSafeMemberAvatar(member);
  const displayName = getSafeMemberDisplayName(member);
  const username = getSafeMemberUsername(member);
  const createdTimestamp = getSafeUnixTimestamp(member?.user?.createdTimestamp);
  const joinedTimestamp = getSafeUnixTimestamp(Date.now());
  const mention = mentionById(member?.id) || 'A new member';
  const authorText = username && username.toLowerCase() !== String(displayName).replace(/^@+/, '').toLowerCase()
    ? `${displayName} (@${username.replace(/^@+/, '')})`
    : displayName;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Welcome to SAVE')
    .setDescription(`${mention} has joined **Statewide Anti-Violence Enforcement**.`)
    .addFields(
      {
        name: 'Getting Started',
        value: [
          `> **[Verify first](${verifyChannelUrl})** with \`/verify\` before using any SAVE systems.`,
          '> Use `/help` to view available commands.',
          'â”€â”€â”€â”€â”€â”€â”€â”€',
          `> [Review over the rules channel](${rulesChannelUrl}).`,
          `> [Read through the SAVE-Info channel](${saveInfoChannelUrl}).`,
          `> [Visit the applications channel](${applicationsChannelUrl}) if you want to apply.`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Account Created',
        value: createdTimestamp
          ? `<t:${createdTimestamp}:F>\n<t:${createdTimestamp}:R>`
          : 'Unknown',
        inline: true,
      },
      {
        name: 'Joined Server',
        value: joinedTimestamp
          ? `<t:${joinedTimestamp}:F>\n<t:${joinedTimestamp}:R>`
          : 'Unknown',
        inline: true,
      },
    )
    .setFooter({ text: `Statewide Anti-Violence Enforcement â€¢ User ID: ${member?.id || 'Unknown'}` })
    .setTimestamp()
    .setImage(joinBannerUrl);

  if (authorText) {
    embed.setAuthor({
      name: authorText,
      iconURL: avatarUrl || undefined,
    });
  }

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return embed;
}

function buildWelcomeDmPayload(member) {
  const avatarUrl = getSafeMemberAvatar(member);
  const displayName = getSafeMemberDisplayName(member);

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Welcome to SAVE')
    .setDescription([
      `> Welcome, **${displayName}**.`,
      '> Here is the quickest path to get situated and, if you want to join SAVE, start moving in the right direction.',
      '',
      '**Joining SAVE**',
      `> **Start with the [applications channel](${applicationsChannelUrl}).**`,
      '> That is the main place to watch for application access and start the process when it is open.',
      '> If applications are being handled through Discord, use `/dmapplication` when directed to do so.',
      '',
      '**Important Starting Points**',
      `> [Verify first](${verifyChannelUrl}) and use \`/verify\` so you can access the rest of the server properly.`,
      `> [Read SAVE Information](${saveInfoChannelUrl}) so you understand what the unit is and how it works.`,
      `> [Review the rules](${rulesChannelUrl}) before using any SAVE systems or tools.`,
      '> Use `/help` in-server to view the commands available to you.',
    ].join('\n'))
    .addFields(
      {
        name: 'Recommended Order',
        value: [
          '> Verify',
          '> Read SAVE-Info',
          '> Review the rules',
          '> Check applications',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Statewide Anti-Violence Enforcement' })
    .setTimestamp();

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Applications')
        .setStyle(ButtonStyle.Link)
        .setURL(applicationsChannelUrl),
      new ButtonBuilder()
        .setLabel('Verify')
        .setStyle(ButtonStyle.Link)
        .setURL(verifyChannelUrl),
      new ButtonBuilder()
        .setLabel('SAVE-Info')
        .setStyle(ButtonStyle.Link)
        .setURL(saveInfoChannelUrl),
      new ButtonBuilder()
        .setLabel('Rules')
        .setStyle(ButtonStyle.Link)
        .setURL(rulesChannelUrl),
    );

  return {
    embeds: [embed],
    components: [row],
  };
}

async function sendWelcomeDm(member) {
  try {
    await member.send(buildWelcomeDmPayload(member));
    writeMemberEventDebug(`sendWelcomeDm:success member=${member?.id || 'unknown'}`);
    return true;
  } catch (error) {
    writeMemberEventDebug(`sendWelcomeDm:failed member=${member?.id || 'unknown'} error=${error?.message || error}`);
    return false;
  }
}

function createServerLogManager({
  client,
  channelId,
  joinLeaveChannelId,
  leaveChannelId,
  leaveWatchRoleId,
  leaveAlertRoleId,
}) {
  let started = false;
  const messageCache = new Map();

  const rememberMessage = (message) => {
    const snapshot = snapshotMessage(message);
    if (!snapshot) return;

    messageCache.set(snapshot.id, snapshot);

    if (messageCache.size > 1500) {
      const oldestKey = messageCache.keys().next().value;
      if (oldestKey) {
        messageCache.delete(oldestKey);
      }
    }
  };

  const bind = (eventName, handler) => {
    client.on(eventName, (...args) => {
      handler(...args).catch((error) => {
        console.error(`Server log handler failed for ${eventName}:`, error);
      });
    });
  };

  return {
    start() {
      if (started || !channelId) return;
      started = true;

      bind(Events.MessageCreate, async (message) => {
        if (!message?.guild || message.system || message.author?.bot) return;
        rememberMessage(message);
      });

      bind(Events.RoleCreate, async (role) => {
        const executor = await fetchExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Role Created',
              color: 0x57f287,
              executor,
              headline: `Role Created: ${formatRole(role)}`,
              bodyLines: [
                `Color: ${role.hexColor || 'None'}`,
              ],
              footerId: role.id,
            }),
          ],
        });
      });

      bind(Events.RoleDelete, async (role) => {
        const executor = await fetchExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Role Deleted',
              color: 0xed4245,
              executor,
              headline: `Role Deleted: ${formatRole(role)}`,
              footerId: role.id,
            }),
          ],
        });
      });

      bind(Events.RoleUpdate, async (oldRole, newRole) => {
        const changes = [];

        if (oldRole.name !== newRole.name) {
          changes.push(`Name: \`${oldRole.name}\` -> \`${newRole.name}\``);
        }

        if (oldRole.hexColor !== newRole.hexColor) {
          changes.push(`Color: \`${oldRole.hexColor}\` -> \`${newRole.hexColor}\``);
        }

        if (oldRole.mentionable !== newRole.mentionable) {
          changes.push(`Mentionable: \`${oldRole.mentionable ? 'Yes' : 'No'}\` -> \`${newRole.mentionable ? 'Yes' : 'No'}\``);
        }

        if (oldRole.hoist !== newRole.hoist) {
          changes.push(`Hoisted: \`${oldRole.hoist ? 'Yes' : 'No'}\` -> \`${newRole.hoist ? 'Yes' : 'No'}\``);
        }

        if (!changes.length) return;

        const executor = await fetchExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Role Updated',
              color: 0xfee75c,
              executor,
              headline: `Role Updated: ${formatRole(newRole)}`,
              bodyLines: changes.map((change) => `• ${change}`),
              footerId: newRole.id,
            }),
          ],
        });
      });

      bind(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
        const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
        const roleExecutor = await fetchExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);

        for (const role of addedRoles.values()) {
          await sendLog(client, channelId, {
            embeds: [
              buildExecutorDynoEmbed({
                title: 'Role Added To Member',
                color: 0x57f287,
                executor: roleExecutor,
                headline: `Role Added To Member: ${formatMember(newMember)}`,
                bodyLines: [
                  `Role: ${formatRole(role)}`,
                ],
                footerId: newMember.id,
              }),
            ],
          });
        }

        for (const role of removedRoles.values()) {
          await sendLog(client, channelId, {
            embeds: [
              buildExecutorDynoEmbed({
                title: 'Role Removed From Member',
                color: 0xed4245,
                executor: roleExecutor,
                headline: `Role Removed From Member: ${formatMember(newMember)}`,
                bodyLines: [
                  `Role: ${formatRole(role)}`,
                ],
                footerId: newMember.id,
              }),
            ],
          });
        }

        if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
          const timeoutActive = Boolean(newMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp > Date.now());
          const timeoutExecutor = await fetchExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
          await sendLog(client, channelId, {
            embeds: [
              buildExecutorDynoEmbed({
                title: timeoutActive ? 'Member Timed Out' : 'Member Timeout Removed',
                color: timeoutActive ? 0xfee75c : 0x57f287,
                executor: timeoutExecutor,
                headline: timeoutActive
                  ? `Member Timed Out: ${formatMember(newMember)}`
                  : `Member Timeout Removed: ${formatMember(newMember)}`,
                bodyLines: [
                  `Until: ${timeoutActive ? `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>` : 'No active timeout'}`,
                ],
                footerId: newMember.id,
              }),
            ],
          });
        }

        if (oldMember.nickname !== newMember.nickname) {
          const nicknameExecutor = await fetchExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
          await sendLog(client, channelId, {
            embeds: [
              buildExecutorDynoEmbed({
                title: 'Nickname Updated',
                color: 0x5865f2,
                executor: nicknameExecutor,
                headline: `Nickname Updated: ${formatMember(newMember)}`,
                bodyLines: [
                  `Before: ${toDisplay(oldMember.nickname, 'None')}`,
                  `After: ${toDisplay(newMember.nickname, 'None')}`,
                ],
                footerId: newMember.id,
              }),
            ],
          });
        }
      });

      bind(Events.GuildMemberAdd, async (member) => {
        await sendLog(client, joinLeaveChannelId || channelId, {
          embeds: [
            buildJoinEmbed(member),
          ],
        });

        await sendWelcomeDm(member);
      });

      bind(Events.GuildMemberRemove, async (member) => {
        writeMemberEventDebug(`GuildMemberRemove:event member=${member?.id || 'unknown'}`);
        const leaveTargetChannelId = leaveChannelId || joinLeaveChannelId || channelId;
        await sendLeaveLog(client, leaveTargetChannelId, member);

        const hadWatchedRole = Boolean(
          leaveWatchRoleId
          && member?.roles?.cache
          && member.roles.cache.has(String(leaveWatchRoleId)),
        );

        writeMemberEventDebug(`GuildMemberRemove:watched-role member=${member?.id || 'unknown'} hasRole=${hadWatchedRole ? 'yes' : 'no'}`);

        if (hadWatchedRole) {
          await sendLeaveAlert(client, leaveTargetChannelId, leaveAlertRoleId, member);
        }

        const auditEntry = await fetchAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
        const executor = auditEntry?.executor || null;
        const wasKicked = Boolean(executor);
        writeMemberEventDebug(`GuildMemberRemove:audit member=${member?.id || 'unknown'} kicked=${wasKicked ? 'yes' : 'no'}`);
        if (!wasKicked) {
          return;
        }

        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Member Kicked',
              color: 0xed4245,
              executor,
              headline: `Member Kicked: ${formatMember(member)}`,
              bodyLines: [
                `Reason: ${toDisplay(auditEntry?.reason, 'No reason provided')}`,
              ],
              footerId: member.id,
            }),
          ],
        });
      });

      bind(Events.GuildBanAdd, async (ban) => {
        const auditEntry = await fetchAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
        const executor = auditEntry?.executor || null;
        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Member Banned',
              color: 0xed4245,
              executor,
              headline: `Member Banned: ${formatUser(ban.user)}`,
              bodyLines: [
                `Reason: ${toDisplay(auditEntry?.reason, 'No reason provided')}`,
              ],
              footerId: ban.user.id,
            }),
          ],
        });
      });

      bind(Events.GuildBanRemove, async (ban) => {
        const auditEntry = await fetchAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
        const executor = auditEntry?.executor || null;
        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Member Unbanned',
              color: 0x57f287,
              executor,
              headline: `Member Unbanned: ${formatUser(ban.user)}`,
              bodyLines: [
                `Reason: ${toDisplay(auditEntry?.reason, 'No reason provided')}`,
              ],
              footerId: ban.user.id,
            }),
          ],
        });
      });

      bind(Events.MessageDelete, async (message) => {
        if (!message?.guild || message.system) return;

        const cachedSnapshot = messageCache.get(message.id) || null;

        if (message.partial) {
          await message.fetch().catch(() => null);
        }

        const liveSnapshot = snapshotMessage(message);
        const bestSnapshot = (liveSnapshot && (liveSnapshot.content || liveSnapshot.attachments.length))
          ? liveSnapshot
          : cachedSnapshot;

        messageCache.delete(message.id);

        const deletedText = formatDeletedMessageContent(bestSnapshot?.content ?? message.content);
        const authorMention = bestSnapshot?.authorId
          ? `<@${bestSnapshot.authorId}>`
          : message.author?.id
            ? `<@${message.author.id}>`
            : formatMessageAuthor(message);
        const channelMention = formatSnapshotChannelMention(bestSnapshot, message.channel);
        const authorId = bestSnapshot?.authorId || message.author?.id || 'Unknown';
        const dynoStyleEmbed = new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription(
            `**Message sent by ${authorMention} Deleted in ${channelMention}**\n${deletedText}`,
          )
          .setFooter({
            text: `Author: ${authorId} | Message ID: ${message.id}`,
          })
          .setTimestamp();

        if (bestSnapshot?.authorTag || message.author?.tag) {
          dynoStyleEmbed.setAuthor({
            name: bestSnapshot?.authorTag || message.author?.tag || 'Unknown author',
            iconURL: bestSnapshot?.authorAvatarUrl || message.author?.displayAvatarURL?.() || undefined,
          });
        }

        const attachmentValue = bestSnapshot
          ? formatSnapshotAttachments(bestSnapshot)
          : formatAttachments(message.attachments);

        if (attachmentValue !== 'None') {
          dynoStyleEmbed.addFields({
            name: 'Attachments',
            value: truncate(attachmentValue, 1000),
            inline: false,
          });
        }

        await sendLog(client, channelId, {
          embeds: [dynoStyleEmbed],
        });
      });

      bind(Events.MessageBulkDelete, async (messages) => {
        if (!messages?.size) return;

        const firstMessage = messages.first();
        if (!firstMessage?.guild) return;

        await sendLog(client, channelId, {
          embeds: [
            buildLogEmbed({
              title: 'Bulk Message Delete',
              color: 0xed4245,
              description: `**Bulk delete:** ${messages.size} message(s) removed in ${formatChannel(firstMessage.channel)}`,
              fields: [
                { name: 'Channel', value: formatChannel(firstMessage.channel), inline: false },
                { name: 'Messages Deleted', value: String(messages.size), inline: true },
              ],
            }),
          ],
        });
      });

      bind(Events.MessageUpdate, async (oldMessage, newMessage) => {
        if (!newMessage?.guild || newMessage.system) return;

        if (oldMessage.partial) {
          await oldMessage.fetch().catch(() => null);
        }

        if (newMessage.partial) {
          await newMessage.fetch().catch(() => null);
        }

        const beforeContent = toDisplay(oldMessage.content, 'Unavailable');
        const afterContent = toDisplay(newMessage.content, 'Unavailable');

        rememberMessage(newMessage);

        if (beforeContent === afterContent) return;

        const dynoStyleEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setDescription(
            [
              `**Message Edited in** ${formatChannel(newMessage.channel)} ${newMessage.url ? `[Jump to Message](${newMessage.url})` : ''}`.trim(),
              '',
              '**Before**',
              truncate(beforeContent, 900),
              '',
              '**after**',
              truncate(afterContent, 900),
            ].join('\n'),
          )
          .setFooter({
            text: `User ID: ${newMessage.author?.id || newMessage.member?.id || 'Unknown'}`,
          })
          .setTimestamp();

        if (newMessage.author?.tag || newMessage.member?.displayName) {
          dynoStyleEmbed.setAuthor({
            name: newMessage.author?.tag || newMessage.member?.displayName || 'Unknown author',
            iconURL: newMessage.author?.displayAvatarURL?.() || undefined,
          });
        }

        await sendLog(client, channelId, {
          embeds: [dynoStyleEmbed],
        });
      });

      bind(Events.ChannelCreate, async (channel) => {
        const executor = await fetchExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Channel Created',
              color: 0x57f287,
              executor,
              headline: `Channel Created: ${formatChannelLabel(channel)}`,
              bodyLines: [
                `Type: ${formatChannelType(channel.type)}`,
              ],
              footerId: channel.id,
            }),
          ],
        });
      });

      bind(Events.ChannelDelete, async (channel) => {
        const executor = await fetchExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        await sendLog(client, channelId, {
          embeds: [
            buildExecutorDynoEmbed({
              title: 'Channel Deleted',
              color: 0xed4245,
              executor,
              headline: `Channel Deleted: ${formatChannelLabel(channel)}`,
              bodyLines: [
                `Type: ${formatChannelType(channel.type)}`,
              ],
              footerId: channel.id,
            }),
          ],
        });
      });

      bind(Events.ChannelUpdate, async (oldChannel, newChannel) => {
        const changes = [];

        if (oldChannel.name !== newChannel.name) {
          changes.push(`Name: \`${oldChannel.name}\` -> \`${newChannel.name}\``);
        }

        if (oldChannel.parentId !== newChannel.parentId) {
          changes.push(`Category: \`${oldChannel.parent?.name || 'None'}\` -> \`${newChannel.parent?.name || 'None'}\``);
        }

        if ('topic' in oldChannel && oldChannel.topic !== newChannel.topic) {
          changes.push('Topic updated');
        }

        changes.push(...collectChannelOverwriteChanges(oldChannel, newChannel));

        if (!changes.length) return;

        const executor = await fetchExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);

        const channelUpdateEmbed = buildExecutorDynoEmbed({
          title: 'Channel Updated',
          color: 0x43b581,
          executor,
          headline: `Channel Updated: ${formatChannelLabel(newChannel)}`,
          bodyLines: changes.map((change) => `• ${String(change).replace(/\n/g, '\n  ')}`),
          footerId: newChannel.id,
        });

        await sendLog(client, channelId, {
          embeds: [channelUpdateEmbed],
        });
      });
    },
  };
}
module.exports = {
  createServerLogManager,
};


