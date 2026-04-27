const { randomUUID } = require('node:crypto');
const {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const RLOOKUP_SELECT_PREFIX = 'rlookup_select';
const SESSION_TTL_MS = 1000 * 60 * 30;
const MAX_RESULTS = 100;
const SELECT_MENU_PAGE_SIZE = 25;

const SEARCH_TYPES = {
  AUTO: 'auto',
  USERNAME: 'username',
  DISPLAY_NAME: 'display_name',
  USER_ID: 'user_id',
};

const PROCESSING_MODES = {
  QUICK: 'quick',
  SLOW: 'slow',
};

const searchSessions = new Map();

function getSearchTypeLabel(type) {
  switch (type) {
    case SEARCH_TYPES.USERNAME:
      return 'Username Search';
    case SEARCH_TYPES.DISPLAY_NAME:
      return 'Display Name Search';
    case SEARCH_TYPES.USER_ID:
      return 'User ID Search';
    case SEARCH_TYPES.AUTO:
    default:
      return 'Auto-detect Search';
  }
}

function getProcessingLabel(mode) {
  return mode === PROCESSING_MODES.SLOW ? 'Slow Thoughts' : 'Quick Processing';
}

function sanitizeLimit(limit) {
  if (!Number.isFinite(limit)) {
    return 5;
  }

  return Math.max(1, Math.min(MAX_RESULTS, Math.trunc(limit)));
}

function sanitizeProcessingMode(mode) {
  return mode === PROCESSING_MODES.SLOW ? PROCESSING_MODES.SLOW : PROCESSING_MODES.QUICK;
}

function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [token, session] of searchSessions.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      searchSessions.delete(token);
    }
  }
}

function setSession(session) {
  cleanupExpiredSessions();
  searchSessions.set(session.token, {
    ...session,
    updatedAt: Date.now(),
  });
}

function getSession(token) {
  cleanupExpiredSessions();
  const session = searchSessions.get(token);
  if (!session) {
    return null;
  }

  session.updatedAt = Date.now();
  return session;
}

function buildSelectCustomId(token, pageIndex) {
  return `${RLOOKUP_SELECT_PREFIX}:${token}:${pageIndex}`;
}

function parseSelectCustomId(customId) {
  if (!customId || !customId.startsWith(`${RLOOKUP_SELECT_PREFIX}:`)) {
    return null;
  }

  const [, token, pageIndexRaw] = customId.split(':');
  if (!token) {
    return null;
  }

  const pageIndex = Number.parseInt(pageIndexRaw, 10);
  return {
    token,
    pageIndex: Number.isFinite(pageIndex) ? pageIndex : 0,
  };
}

async function fetchJson(url, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this Node runtime.');
  }

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Roblox lookup failed (${response.status}): ${body || response.statusText}`);
  }

  return response.json();
}

function normalizeUser(rawUser) {
  const id = rawUser?.id ?? rawUser?.userId ?? rawUser?.targetId;
  const username = rawUser?.name ?? rawUser?.username ?? 'Unknown';
  const displayName = rawUser?.displayName ?? rawUser?.display_name ?? username;

  return {
    id: String(id),
    username,
    displayName,
    hasVerifiedBadge: Boolean(rawUser?.hasVerifiedBadge),
    profileUrl: `https://www.roblox.com/users/${id}/profile`,
    thumbnailUrl: rawUser?.thumbnailUrl || null,
  };
}

async function lookupByUsername(username) {
  const payload = await fetchJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: false,
    }),
  });

  return Array.isArray(payload?.data) ? payload.data.map(normalizeUser) : [];
}

async function lookupByUserId(userId) {
  const payload = await fetchJson('https://users.roblox.com/v1/users', {
    method: 'POST',
    body: JSON.stringify({
      userIds: [Number(userId)],
      excludeBannedUsers: false,
    }),
  });

  return Array.isArray(payload?.data) ? payload.data.map(normalizeUser) : [];
}

async function lookupByDisplayName(keyword, limit) {
  const apiLimit = limit <= 10
    ? 10
    : limit <= 25
      ? 25
      : limit <= 50
        ? 50
        : 100;

  const url = new URL('https://users.roblox.com/v1/users/search');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('limit', String(apiLimit));

  const payload = await fetchJson(url.toString(), {
    method: 'GET',
  });

  return Array.isArray(payload?.data) ? payload.data.map(normalizeUser) : [];
}

async function attachThumbnails(users) {
  if (!users.length) {
    return users;
  }

  const ids = users.map((user) => user.id).join(',');
  const url = new URL('https://thumbnails.roblox.com/v1/users/avatar-bust');
  url.searchParams.set('userIds', ids);
  url.searchParams.set('size', '150x150');
  url.searchParams.set('format', 'Png');
  url.searchParams.set('isCircular', 'false');

  try {
    const payload = await fetchJson(url.toString(), { method: 'GET' });
    const thumbnailMap = new Map(
      Array.isArray(payload?.data)
        ? payload.data.map((entry) => [String(entry.targetId), entry.imageUrl || null])
        : [],
    );

    return users.map((user) => ({
      ...user,
      thumbnailUrl: thumbnailMap.get(user.id) || user.thumbnailUrl,
    }));
  } catch (error) {
    return users;
  }
}

function dedupeUsers(users) {
  const seen = new Set();
  return users.filter((user) => {
    if (!user?.id || seen.has(user.id)) {
      return false;
    }

    seen.add(user.id);
    return true;
  });
}

async function searchRobloxUsers({ query, type, limit, processingMode }) {
  const trimmedQuery = query.trim();
  const safeLimit = sanitizeLimit(limit);
  const safeProcessingMode = sanitizeProcessingMode(processingMode);
  let resolvedType = type || SEARCH_TYPES.AUTO;
  let users = [];

  if (resolvedType === SEARCH_TYPES.AUTO) {
    if (/^\d+$/.test(trimmedQuery)) {
      resolvedType = SEARCH_TYPES.USER_ID;
      users = await lookupByUserId(trimmedQuery);
    } else {
      const usernameUsers = await lookupByUsername(trimmedQuery);
      if (usernameUsers.length) {
        resolvedType = SEARCH_TYPES.USERNAME;
        users = usernameUsers;
      } else {
        resolvedType = SEARCH_TYPES.DISPLAY_NAME;
        users = await lookupByDisplayName(trimmedQuery, safeLimit);
      }
    }
  } else if (resolvedType === SEARCH_TYPES.USERNAME) {
    users = await lookupByUsername(trimmedQuery);
  } else if (resolvedType === SEARCH_TYPES.USER_ID) {
    if (!/^\d+$/.test(trimmedQuery)) {
      throw new Error('User ID searches must use numbers only.');
    }

    users = await lookupByUserId(trimmedQuery);
  } else {
    users = await lookupByDisplayName(trimmedQuery, safeLimit);
  }

  const dedupedUsers = dedupeUsers(users).slice(0, safeLimit);
  const results = safeProcessingMode === PROCESSING_MODES.SLOW
    ? await attachThumbnails(dedupedUsers)
    : dedupedUsers;

  return {
    query: trimmedQuery,
    requestedType: type || SEARCH_TYPES.AUTO,
    resolvedType,
    processingMode: safeProcessingMode,
    results,
  };
}

function truncate(value, maxLength) {
  if (!value) {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatVerified(value) {
  return value ? 'Yes' : 'No';
}

function buildResultList(results, selectedIndex, searchType) {
  const otherUsers = results.filter((_, index) => index !== selectedIndex);
  if (!otherUsers.length) {
    return null;
  }

  const previewUsers = otherUsers.slice(0, 10);
  const heading = searchType === SEARCH_TYPES.DISPLAY_NAME
    ? `Similar Display Names (${otherUsers.length})`
    : `Additional Results (${otherUsers.length})`;

  const lines = previewUsers.map((user) => {
    const displayIndex = results.findIndex((candidate) => candidate.id === user.id) + 1;
    return `${displayIndex}. **${user.displayName}** (@${user.username}) ID: ${user.id}`;
  });

  if (otherUsers.length > previewUsers.length) {
    lines.push(`...and ${otherUsers.length - previewUsers.length} more result(s) in the menus below.`);
  }

  return [heading, ...lines].join('\n');
}

function buildLookupEmbed(session) {
  const selectedUser = session.results[session.selectedIndex] || session.results[0];
  const descriptionParts = [
    `**Search:** ${session.query}`,
    `**Type:** ${getSearchTypeLabel(session.resolvedType)}`,
    '',
    `**${selectedUser.displayName}**`,
    `**Username:** @${selectedUser.username}`,
    `**ID:** ${selectedUser.id}`,
    `**Verified:** ${formatVerified(selectedUser.hasVerifiedBadge)}`,
    `[View Profile](${selectedUser.profileUrl})`,
  ];

  const resultList = buildResultList(session.results, session.selectedIndex, session.resolvedType);
  if (resultList) {
    descriptionParts.push('', resultList);
  }

  let description = descriptionParts.join('\n');
  if (description.length > 4000) {
    description = `${description.slice(0, 3996)}...`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x00d1b2)
    .setTitle('Roblox User Lookup')
    .setDescription(description)
    .setFooter({
      text: `Found ${session.results.length} result(s) | Search type: ${getSearchTypeLabel(session.resolvedType)} | ${getProcessingLabel(session.processingMode)}`,
    })
    .setTimestamp();

  if (selectedUser.thumbnailUrl) {
    embed.setThumbnail(selectedUser.thumbnailUrl);
  }

  return embed;
}

function buildResultSelectRows(session) {
  if (session.results.length <= 1) {
    return [];
  }

  const rows = [];
  const pageCount = Math.ceil(session.results.length / SELECT_MENU_PAGE_SIZE);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const start = pageIndex * SELECT_MENU_PAGE_SIZE;
    const end = start + SELECT_MENU_PAGE_SIZE;
    const pageResults = session.results.slice(start, end);

    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildSelectCustomId(session.token, pageIndex))
      .setPlaceholder('Select user for details...')
      .addOptions(
        pageResults.map((user, index) => {
          const absoluteIndex = start + index;
          const selected = absoluteIndex === session.selectedIndex;
          const labelPrefix = selected ? '* ' : `${absoluteIndex + 1}. `;
          return {
            label: truncate(`${labelPrefix}${user.displayName}`, 100),
            description: truncate(`@${user.username} | ID: ${user.id}`, 100),
            value: String(absoluteIndex),
            default: selected,
          };
        }),
      );

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return rows;
}

function buildLookupPayload(session) {
  return {
    embeds: [buildLookupEmbed(session)],
    components: buildResultSelectRows(session),
  };
}

function createLookupSession({ ownerId, query, requestedType, resolvedType, processingMode, results }) {
  const token = randomUUID();
  const session = {
    token,
    ownerId,
    query,
    requestedType,
    resolvedType,
    processingMode: sanitizeProcessingMode(processingMode),
    results,
    selectedIndex: 0,
  };

  setSession(session);
  return session;
}

function buildNoResultsEmbed({ query, resolvedType, processingMode }) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Roblox User Lookup')
    .setDescription(
      [
        `**Search:** ${query}`,
        `**Type:** ${getSearchTypeLabel(resolvedType)}`,
        `**Processing:** ${getProcessingLabel(processingMode)}`,
        '',
        'No Roblox users were found for that search.',
      ].join('\n'),
    )
    .setTimestamp();
}

async function handleLookupSelectInteraction(interaction) {
  const parsed = parseSelectCustomId(interaction.customId);
  if (!parsed || !interaction.isStringSelectMenu()) {
    return false;
  }

  const session = getSession(parsed.token);
  if (!session) {
    await interaction.reply({
      content: 'That lookup session expired. Run `/rlookup` again.',
      ephemeral: true,
    });
    return true;
  }

  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({
      content: 'Only the person who ran this lookup can change the selected result.',
      ephemeral: true,
    });
    return true;
  }

  const selectedIndex = Number.parseInt(interaction.values?.[0], 10);
  if (!Number.isFinite(selectedIndex) || !session.results[selectedIndex]) {
    await interaction.reply({
      content: 'That lookup result is no longer available.',
      ephemeral: true,
    });
    return true;
  }

  session.selectedIndex = selectedIndex;
  setSession(session);

  await interaction.update(buildLookupPayload(session));
  return true;
}

module.exports = {
  MAX_RESULTS,
  PROCESSING_MODES,
  SEARCH_TYPES,
  buildLookupPayload,
  buildNoResultsEmbed,
  createLookupSession,
  getSearchTypeLabel,
  handleLookupSelectInteraction,
  searchRobloxUsers,
};
