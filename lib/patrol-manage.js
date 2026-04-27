const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  calculatePatrolDuration,
  deletePatrolLogEntry,
  fetchPersonnelDirectory,
  fetchRecentPatrolLogs,
  updatePatrolLogEntry,
} = require('./patrol-log');

const SESSION_TTL_MS = 1000 * 60 * 30;
const PAGE_SIZE = 25;
const AUDIT_LIMIT = 1500;
const AUDIT_FILE = path.join(__dirname, '..', 'data', 'patrol-manage-audit.json');
const DEFAULT_EDIT_ROLE_ID = '1465136661187924105';

const BUTTON_PREFIX = 'patrol_manage_btn';
const SELECT_PREFIX = 'patrol_manage_select';
const MODAL_PREFIX = 'patrol_manage_modal';

const VIEW_USERS = 'users';
const VIEW_LOGS = 'logs';
const VIEW_DETAIL = 'detail';
const VIEW_HISTORY = 'history';
const VIEW_DELETE_CONFIRM = 'delete_confirm';

const sessions = new Map();

function getEditRoleId() {
  return process.env.REQUIRED_COMMAND_ROLE_ID || DEFAULT_EDIT_ROLE_ID;
}

function ensureAuditDir() {
  fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
}

function loadAuditEntries() {
  ensureAuditDir();

  try {
    const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAuditEntries(entries) {
  ensureAuditDir();
  fs.writeFileSync(
    AUDIT_FILE,
    JSON.stringify(entries.slice(-AUDIT_LIMIT), null, 2),
    'utf8',
  );
}

function appendAuditEntry(entry) {
  const current = loadAuditEntries();
  current.push(entry);
  saveAuditEntries(current);
}

function getAuditEntriesForLog(logId) {
  return loadAuditEntries()
    .filter((entry) => entry?.logId === logId)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if ((now - session.updatedAt) > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}

function setSession(session) {
  cleanupExpiredSessions();
  sessions.set(session.token, {
    ...session,
    updatedAt: Date.now(),
  });
}

function getSession(token) {
  cleanupExpiredSessions();
  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  session.updatedAt = Date.now();
  return session;
}

function sanitizeText(value, maxLength = 300) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function truncate(value, maxLength = 100) {
  const text = sanitizeText(value, Math.max(maxLength, 3));
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function clampPageIndex(totalItems, pageIndex) {
  const pageCount = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  return Math.min(Math.max(0, Number(pageIndex) || 0), pageCount - 1);
}

function slicePage(items, pageIndex) {
  const safePage = clampPageIndex(items.length, pageIndex);
  const start = safePage * PAGE_SIZE;
  return {
    safePage,
    pageCount: Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
    items: items.slice(start, start + PAGE_SIZE),
  };
}

function formatTimestamp(value, style = 'f') {
  if (!value) {
    return 'Unknown';
  }

  const unix = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(unix) || unix <= 0) {
    return 'Unknown';
  }

  return `<t:${unix}:${style}>`;
}

function formatAuditSummary(snapshot) {
  if (!snapshot) {
    return 'No snapshot recorded.';
  }

  return [
    snapshot.rankText ? `Rank: ${snapshot.rankText}` : null,
    snapshot.startTime && snapshot.endTime ? `Window: ${snapshot.startTime} - ${snapshot.endTime}` : null,
    snapshot.proofUrl ? `Proof: ${truncate(snapshot.proofUrl, 120)}` : null,
    snapshot.notes ? `Notes: ${truncate(snapshot.notes, 140)}` : 'Notes: None',
  ].filter(Boolean).join(' | ');
}

function createSnapshot(log) {
  if (!log) {
    return null;
  }

  return {
    id: log.id || null,
    patrolLabel: log.patrol_label || null,
    username: log.username || null,
    rankText: log.rank_text || log.rank_code || null,
    startTime: log.start_time || null,
    endTime: log.end_time || null,
    proofUrl: log.proof_url || null,
    notes: log.notes || null,
    createdAt: log.created_at || null,
  };
}

function buildUserDirectory(logs, directory) {
  const personnelByUsername = new Map();
  for (const entry of directory) {
    const key = normalizeKey(entry?.roblox_username);
    if (key && !personnelByUsername.has(key)) {
      personnelByUsername.set(key, entry);
    }
  }

  const grouped = new Map();

  for (const log of logs) {
    const key = normalizeKey(log?.username);
    if (!key) {
      continue;
    }

    const existing = grouped.get(key) || {
      key,
      username: sanitizeText(log.username, 80) || 'Unknown',
      count: 0,
      latestCreatedAt: log.created_at || null,
    };

    existing.count += 1;

    const createdMs = new Date(log?.created_at || 0).getTime();
    const latestMs = new Date(existing.latestCreatedAt || 0).getTime();
    if (Number.isFinite(createdMs) && createdMs > latestMs) {
      existing.latestCreatedAt = log.created_at;
      existing.username = sanitizeText(log.username, 80) || existing.username;
    }

    grouped.set(key, existing);
  }

  const users = [];

  for (const user of grouped.values()) {
    const personnel = personnelByUsername.get(user.key);
    users.push({
      ...user,
      callsign: sanitizeText(personnel?.callsign, 20),
      rank: sanitizeText(personnel?.rank, 40),
      discordName: sanitizeText(personnel?.discord, 80),
      discordId: sanitizeText(personnel?.discord_id, 40),
    });
  }

  return users.sort((left, right) => {
    const rightMs = new Date(right.latestCreatedAt || 0).getTime();
    const leftMs = new Date(left.latestCreatedAt || 0).getTime();
    if (rightMs !== leftMs) {
      return rightMs - leftMs;
    }

    return left.username.localeCompare(right.username);
  });
}

function filterUsers(session) {
  const query = normalizeKey(session.searchQuery);
  if (!query) {
    return session.users;
  }

  return session.users.filter((user) => {
    const haystack = [
      user.username,
      user.callsign,
      user.rank,
      user.discordName,
      user.discordId,
    ].map((value) => normalizeKey(value)).join(' ');

    return haystack.includes(query);
  });
}

function getSelectedUser(session) {
  if (!session.selectedUserKey) {
    return null;
  }

  return session.users.find((user) => user.key === session.selectedUserKey) || null;
}

function getLogsForUser(session, userKey = session.selectedUserKey) {
  const normalizedKey = normalizeKey(userKey);
  return session.logs
    .filter((log) => normalizeKey(log?.username) === normalizedKey)
    .sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime());
}

function getSelectedLog(session) {
  if (!session.selectedLogId) {
    return null;
  }

  return session.logs.find((log) => log.id === session.selectedLogId) || null;
}

function getDuplicateWarnings(session, log) {
  if (!log) {
    return [];
  }

  const sameUserLogs = session.logs.filter((candidate) => (
    candidate.id !== log.id
    && normalizeKey(candidate.username) === normalizeKey(log.username)
  ));

  const warnings = [];

  const sameProofLogs = sameUserLogs.filter((candidate) => (
    sanitizeText(candidate.proof_url, 900)
    && sanitizeText(candidate.proof_url, 900) === sanitizeText(log.proof_url, 900)
  ));

  if (sameProofLogs.length) {
    warnings.push(`Same proof link appears on ${sameProofLogs.length} other patrol log(s).`);
  }

  const logDay = log.created_at ? new Date(log.created_at).toISOString().slice(0, 10) : null;
  const sameWindowLogs = sameUserLogs.filter((candidate) => {
    const candidateDay = candidate.created_at ? new Date(candidate.created_at).toISOString().slice(0, 10) : null;
    return (
      candidate.start_time === log.start_time
      && candidate.end_time === log.end_time
      && candidateDay
      && candidateDay === logDay
    );
  });

  if (sameWindowLogs.length) {
    warnings.push(`Same time window appears on ${sameWindowLogs.length} other patrol log(s) from the same day.`);
  }

  return warnings;
}

function buildButtonCustomId(token, action) {
  return `${BUTTON_PREFIX}:${token}:${action}`;
}

function buildSelectCustomId(token, kind) {
  return `${SELECT_PREFIX}:${token}:${kind}`;
}

function buildModalCustomId(token, kind) {
  return `${MODAL_PREFIX}:${token}:${kind}`;
}

function parseInteractionCustomId(customId, prefix) {
  if (!customId || !customId.startsWith(`${prefix}:`)) {
    return null;
  }

  const [, token, action] = customId.split(':');
  if (!token || !action) {
    return null;
  }

  return { token, action };
}

function buildUserListPayload(session, notice = null) {
  const filteredUsers = filterUsers(session);
  const page = slicePage(filteredUsers, session.userPage);
  session.userPage = page.safePage;

  const descriptionLines = [
    '> Select a patrol logger below to review, edit, or delete patrol entries.',
    '> Search supports Roblox usernames, callsigns, and linked Discord names.',
  ];

  if (session.searchQuery) {
    descriptionLines.push(`> Active Search: \`${session.searchQuery}\``);
  }

  if (notice) {
    descriptionLines.push(`> ${notice}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x4a9fd4)
    .setTitle('SAVE Patrol Manager')
    .setDescription(descriptionLines.join('\n'))
    .setFooter({
      text: `Players ${filteredUsers.length ? `${page.safePage + 1}/${page.pageCount}` : '0/0'} • Patrol logs loaded: ${session.logs.length}`,
    })
    .setTimestamp();

  if (page.items.length) {
    embed.addFields({
      name: 'Visible Players',
      value: page.items.map((user, index) => {
        const number = (page.safePage * PAGE_SIZE) + index + 1;
        const parts = [
          `${number}. **${user.username}**`,
          user.callsign ? `Callsign ${user.callsign}` : null,
          `${user.count} patrol log(s)`,
          user.latestCreatedAt ? formatTimestamp(user.latestCreatedAt, 'R') : null,
        ].filter(Boolean);
        return parts.join(' | ');
      }).join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: 'Visible Players',
      value: 'No patrol loggers match the current search.',
      inline: false,
    });
  }

  const components = [];

  if (page.items.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildSelectCustomId(session.token, 'user'))
          .setPlaceholder('Select a player to manage...')
          .addOptions(
            page.items.map((user) => ({
              label: truncate(user.username, 100),
              description: truncate(
                [
                  user.callsign ? `Callsign ${user.callsign}` : 'No callsign',
                  `${user.count} patrol log(s)`,
                ].join(' | '),
                100,
              ),
              value: user.key,
            })),
          ),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'user_prev'))
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.safePage <= 0),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'user_next'))
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.safePage >= page.pageCount - 1),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'user_search'))
        .setLabel('Search')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'user_clear'))
        .setLabel('Clear Search')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!session.searchQuery),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'user_refresh'))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    content: null,
    embeds: [embed],
    components,
  };
}

function buildLogListPayload(session, notice = null) {
  const selectedUser = getSelectedUser(session);
  const logs = getLogsForUser(session);

  if (!selectedUser) {
    session.view = VIEW_USERS;
    return buildUserListPayload(session, notice || 'That player is no longer available in the current patrol log list.');
  }

  const page = slicePage(logs, session.logPage);
  session.logPage = page.safePage;

  const descriptionLines = [
    `> Managing patrol logs for **${selectedUser.username}**.`,
    selectedUser.callsign ? `> Callsign: \`${selectedUser.callsign}\`` : '> Callsign: not linked in SAVE Tracker.',
    '> Select a patrol entry below to open edit, delete, duplicate check, or history controls.',
  ];

  if (notice) {
    descriptionLines.push(`> ${notice}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x3a6ea5)
    .setTitle(`Patrol Logs - ${selectedUser.username}`)
    .setDescription(descriptionLines.join('\n'))
    .setFooter({
      text: `Logs ${logs.length ? `${page.safePage + 1}/${page.pageCount}` : '0/0'} • ${selectedUser.count} total patrol log(s)`,
    })
    .setTimestamp();

  if (page.items.length) {
    embed.addFields({
      name: 'Visible Patrol Logs',
      value: page.items.map((log, index) => {
        const number = (page.safePage * PAGE_SIZE) + index + 1;
        const warningCount = getDuplicateWarnings(session, log).length;
        const summary = [
          `${number}. **${log.patrol_label || `PATROL #${log.patrol_number || '?'}`}**`,
          `${log.start_time || '??'} - ${log.end_time || '??'}`,
          calculatePatrolDuration(log.start_time, log.end_time),
          log.created_at ? formatTimestamp(log.created_at, 'R') : null,
          warningCount ? `${warningCount} warning(s)` : null,
        ].filter(Boolean);
        return summary.join(' | ');
      }).join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: 'Visible Patrol Logs',
      value: 'No patrol logs are available for that player right now.',
      inline: false,
    });
  }

  const components = [];

  if (page.items.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildSelectCustomId(session.token, 'log'))
          .setPlaceholder('Select a patrol log...')
          .addOptions(
            page.items.map((log) => ({
              label: truncate(log.patrol_label || `PATROL #${log.patrol_number || '?'}`, 100),
              description: truncate(
                [
                  `${log.start_time || '??'} - ${log.end_time || '??'}`,
                  log.created_at ? formatTimestamp(log.created_at, 'R') : 'Unknown date',
                ].join(' | '),
                100,
              ),
              value: log.id,
            })),
          ),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'log_prev'))
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.safePage <= 0),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'log_next'))
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.safePage >= page.pageCount - 1),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'log_refresh'))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'back_users'))
        .setLabel('Back To Players')
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return {
    content: null,
    embeds: [embed],
    components,
  };
}

function buildLogDetailPayload(session, notice = null) {
  const log = getSelectedLog(session);
  const selectedUser = getSelectedUser(session);

  if (!log) {
    session.view = VIEW_LOGS;
    return buildLogListPayload(session, notice || 'That patrol log is no longer available.');
  }

  const warnings = getDuplicateWarnings(session, log);
  const historyCount = getAuditEntriesForLog(log.id).length;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(log.patrol_label || `PATROL #${log.patrol_number || '?'}`)
    .setDescription(
      [
        `> **Username:** ${selectedUser?.username || log.username || 'Unknown'}`,
        `> **Callsign:** ${selectedUser?.callsign || 'Not linked'}`,
        `> **Rank:** ${log.rank_text || log.rank_code || 'Unknown'}`,
        `> **Window:** ${log.start_time || '??'} - ${log.end_time || '??'}`,
        `> **Duration:** ${calculatePatrolDuration(log.start_time, log.end_time)}`,
        `> **Logged At:** ${formatTimestamp(log.created_at, 'F')} - ${formatTimestamp(log.created_at, 'R')}`,
        `> **Proof:** ${log.proof_url ? `[Open Proof Message](${log.proof_url})` : 'No proof on file'}`,
      ].join('\n'),
    )
    .setFooter({
      text: `History entries: ${historyCount} • Patrol ID: ${log.id}`,
    })
    .setTimestamp();

  if (log.notes) {
    embed.addFields({
      name: 'Notes',
      value: truncate(log.notes, 1024) || 'None',
      inline: false,
    });
  }

  embed.addFields({
    name: 'Duplicate Check',
    value: warnings.length ? warnings.map((warning) => `- ${warning}`).join('\n') : 'No duplicate warnings were found for this patrol entry.',
    inline: false,
  });

  if (notice) {
    embed.addFields({
      name: 'Status',
      value: notice,
      inline: false,
    });
  }

  return {
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'edit'))
          .setLabel('Edit Patrol')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'delete_prompt'))
          .setLabel('Delete Patrol')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'history'))
          .setLabel('View History')
          .setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'detail_refresh'))
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'back_logs'))
          .setLabel('Back To Patrols')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'back_users'))
          .setLabel('Back To Players')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildHistoryPayload(session) {
  const log = getSelectedLog(session);
  const history = getAuditEntriesForLog(session.selectedLogId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Patrol Edit History')
    .setTimestamp();

  if (log) {
    embed.setDescription(
      [
        `> **Patrol:** ${log.patrol_label || `PATROL #${log.patrol_number || '?'}`}`,
        `> **Username:** ${log.username || 'Unknown'}`,
        `> **Patrol ID:** \`${log.id}\``,
      ].join('\n'),
    );
  } else {
    embed.setDescription(`> Showing stored history for patrol ID \`${session.selectedLogId}\`.`);
  }

  if (history.length) {
    embed.addFields({
      name: 'Recent Audit Entries',
      value: history.slice(0, 8).map((entry, index) => {
        const header = `${index + 1}. **${String(entry.action || 'update').toUpperCase()}** by ${entry.actorMention || entry.actorTag || 'Unknown'} - ${formatTimestamp(entry.timestamp, 'R')}`;
        const before = entry.before ? `Before: ${formatAuditSummary(entry.before)}` : null;
        const after = entry.after ? `After: ${formatAuditSummary(entry.after)}` : null;
        return [header, before, after].filter(Boolean).join('\n');
      }).join('\n\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: 'Recent Audit Entries',
      value: 'No patrol edits or deletions have been recorded for this patrol yet.',
      inline: false,
    });
  }

  return {
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'history_refresh'))
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'back_detail'))
          .setLabel('Back To Patrol')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'back_logs'))
          .setLabel('Back To Patrols')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildDeleteConfirmPayload(session) {
  const log = getSelectedLog(session);

  if (!log) {
    session.view = VIEW_LOGS;
    return buildLogListPayload(session, 'That patrol log is no longer available.');
  }

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Confirm Patrol Deletion')
    .setDescription(
      [
        '> This will permanently delete the selected patrol log from the SAVE tracker.',
        '> This action cannot be undone from Discord once confirmed.',
        '',
        `> **Patrol:** ${log.patrol_label || `PATROL #${log.patrol_number || '?'}`}`,
        `> **Username:** ${log.username || 'Unknown'}`,
        `> **Window:** ${log.start_time || '??'} - ${log.end_time || '??'}`,
      ].join('\n'),
    )
    .setTimestamp();

  return {
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'delete_confirm'))
          .setLabel('Confirm Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'delete_cancel'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildPayloadForView(session, notice = null) {
  switch (session.view) {
    case VIEW_LOGS:
      return buildLogListPayload(session, notice);
    case VIEW_DETAIL:
      return buildLogDetailPayload(session, notice);
    case VIEW_HISTORY:
      return buildHistoryPayload(session);
    case VIEW_DELETE_CONFIRM:
      return buildDeleteConfirmPayload(session);
    case VIEW_USERS:
    default:
      return buildUserListPayload(session, notice);
  }
}

function buildSearchModal(session) {
  const modal = new ModalBuilder()
    .setCustomId(buildModalCustomId(session.token, 'search'))
    .setTitle('Search Patrol Loggers');

  const queryInput = new TextInputBuilder()
    .setCustomId('query')
    .setLabel('Username, callsign, or linked Discord name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setValue(session.searchQuery || '');

  modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
  return modal;
}

function buildEditModal(session) {
  const log = getSelectedLog(session);
  const modal = new ModalBuilder()
    .setCustomId(buildModalCustomId(session.token, 'edit'))
    .setTitle('Edit Patrol Log');

  const rankInput = new TextInputBuilder()
    .setCustomId('rank_text')
    .setLabel('Rank')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(40)
    .setValue(log?.rank_text || log?.rank_code || '');

  const startInput = new TextInputBuilder()
    .setCustomId('start_time')
    .setLabel('Start Time')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20)
    .setValue(log?.start_time || '');

  const endInput = new TextInputBuilder()
    .setCustomId('end_time')
    .setLabel('End Time')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20)
    .setValue(log?.end_time || '');

  const proofInput = new TextInputBuilder()
    .setCustomId('proof_url')
    .setLabel('Proof Link')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(300)
    .setValue(log?.proof_url || '');

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setValue(log?.notes || '');

  modal.addComponents(
    new ActionRowBuilder().addComponents(rankInput),
    new ActionRowBuilder().addComponents(startInput),
    new ActionRowBuilder().addComponents(endInput),
    new ActionRowBuilder().addComponents(proofInput),
    new ActionRowBuilder().addComponents(notesInput),
  );

  return modal;
}

async function refreshSessionData(session) {
  const [logs, directory] = await Promise.all([
    fetchRecentPatrolLogs(500),
    fetchPersonnelDirectory(1000).catch(() => []),
  ]);

  session.logs = logs;
  session.directory = directory;
  session.users = buildUserDirectory(logs, directory);

  if (!session.users.length) {
    session.selectedUserKey = null;
    session.selectedLogId = null;
    session.userPage = 0;
    session.logPage = 0;
    session.view = VIEW_USERS;
    return session;
  }

  if (session.selectedUserKey && !session.users.some((user) => user.key === session.selectedUserKey)) {
    session.selectedUserKey = null;
    session.selectedLogId = null;
    session.logPage = 0;
    session.view = VIEW_USERS;
  }

  if (session.selectedUserKey) {
    const logsForUser = getLogsForUser(session);
    if (!logsForUser.length) {
      session.selectedUserKey = null;
      session.selectedLogId = null;
      session.logPage = 0;
      session.view = VIEW_USERS;
    } else if (session.selectedLogId && !logsForUser.some((log) => log.id === session.selectedLogId)) {
      session.selectedLogId = logsForUser[0]?.id || null;
      if (session.view === VIEW_DETAIL || session.view === VIEW_HISTORY || session.view === VIEW_DELETE_CONFIRM) {
        session.view = VIEW_LOGS;
      }
    }
  }

  return session;
}

async function createPatrolManageSession(ownerId) {
  const session = {
    token: randomUUID(),
    ownerId,
    updatedAt: Date.now(),
    users: [],
    logs: [],
    directory: [],
    selectedUserKey: null,
    selectedLogId: null,
    searchQuery: '',
    userPage: 0,
    logPage: 0,
    view: VIEW_USERS,
  };

  await refreshSessionData(session);

  if (!session.logs.length) {
    throw new Error('No patrol logs were found to manage right now.');
  }

  setSession(session);
  return session;
}

async function ensureOwnedSession(interaction, token) {
  const session = getSession(token);
  if (!session) {
    await interaction.reply({
      content: 'That patrol manager session expired. Run `/patrolmanage` again.',
      ephemeral: true,
    }).catch(() => null);
    return null;
  }

  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({
      content: 'Only the person who opened this patrol manager can use it.',
      ephemeral: true,
    }).catch(() => null);
    return null;
  }

  return session;
}

async function replyWithPayload(interaction, payload) {
  if (interaction.message) {
    await interaction.update(payload);
    return;
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return;
  }

  await interaction.reply({
    ...payload,
    ephemeral: true,
  });
}

function canEditPatrol(interaction) {
  const editRoleId = getEditRoleId();
  return Boolean(interaction.member?.roles?.cache?.has(editRoleId));
}

async function handlePatrolManageButtonInteraction(interaction) {
  const parsed = parseInteractionCustomId(interaction.customId, BUTTON_PREFIX);
  if (!parsed || !interaction.isButton()) {
    return false;
  }

  const session = await ensureOwnedSession(interaction, parsed.token);
  if (!session) {
    return true;
  }

  switch (parsed.action) {
    case 'user_prev':
      session.view = VIEW_USERS;
      session.userPage -= 1;
      break;
    case 'user_next':
      session.view = VIEW_USERS;
      session.userPage += 1;
      break;
    case 'user_refresh':
      await refreshSessionData(session);
      session.view = VIEW_USERS;
      setSession(session);
      await interaction.update(buildUserListPayload(session, 'Patrol manager refreshed.'));
      return true;
    case 'user_search':
      await interaction.showModal(buildSearchModal(session));
      return true;
    case 'user_clear':
      session.searchQuery = '';
      session.userPage = 0;
      session.view = VIEW_USERS;
      setSession(session);
      await interaction.update(buildUserListPayload(session, 'Search cleared.'));
      return true;
    case 'log_prev':
      session.view = VIEW_LOGS;
      session.logPage -= 1;
      break;
    case 'log_next':
      session.view = VIEW_LOGS;
      session.logPage += 1;
      break;
    case 'log_refresh':
      await refreshSessionData(session);
      session.view = session.selectedUserKey ? VIEW_LOGS : VIEW_USERS;
      setSession(session);
      await interaction.update(buildPayloadForView(session, 'Patrol list refreshed.'));
      return true;
    case 'back_users':
      session.view = VIEW_USERS;
      break;
    case 'back_logs':
      session.view = VIEW_LOGS;
      break;
    case 'back_detail':
      session.view = VIEW_DETAIL;
      break;
    case 'detail_refresh':
      await refreshSessionData(session);
      session.view = session.selectedLogId ? VIEW_DETAIL : VIEW_LOGS;
      setSession(session);
      await interaction.update(buildPayloadForView(session, 'Patrol detail refreshed.'));
      return true;
    case 'history':
      session.view = VIEW_HISTORY;
      break;
    case 'history_refresh':
      session.view = VIEW_HISTORY;
      break;
    case 'edit':
      if (!canEditPatrol(interaction)) {
        await interaction.reply({
          content: `You need <@&${getEditRoleId()}> to edit patrol logs.`,
          ephemeral: true,
        }).catch(() => null);
        return true;
      }

      if (!getSelectedLog(session)) {
        await interaction.reply({
          content: 'That patrol log is no longer available to edit.',
          ephemeral: true,
        }).catch(() => null);
        return true;
      }

      await interaction.showModal(buildEditModal(session));
      return true;
    case 'delete_prompt':
      session.view = VIEW_DELETE_CONFIRM;
      setSession(session);
      await interaction.update(buildDeleteConfirmPayload(session));
      return true;
    case 'delete_cancel':
      session.view = VIEW_DETAIL;
      setSession(session);
      await interaction.update(buildLogDetailPayload(session));
      return true;
    case 'delete_confirm': {
      const selectedLog = getSelectedLog(session);
      if (!selectedLog) {
        session.view = VIEW_LOGS;
        setSession(session);
        await interaction.update(buildLogListPayload(session, 'That patrol log was already removed.'));
        return true;
      }

      const deleted = await deletePatrolLogEntry(selectedLog.id);
      appendAuditEntry({
        id: randomUUID(),
        logId: selectedLog.id,
        action: 'delete',
        actorId: interaction.user.id,
        actorTag: interaction.user.tag || interaction.user.username,
        actorMention: `<@${interaction.user.id}>`,
        timestamp: new Date().toISOString(),
        before: createSnapshot(deleted || selectedLog),
        after: null,
      });

      await refreshSessionData(session);

      if (session.selectedUserKey) {
        const remainingLogs = getLogsForUser(session);
        session.selectedLogId = remainingLogs[0]?.id || null;
        session.view = remainingLogs.length ? VIEW_LOGS : VIEW_USERS;
      } else {
        session.view = VIEW_USERS;
      }

      setSession(session);
      await interaction.update(buildPayloadForView(session, 'Patrol deleted successfully.'));
      return true;
    }
    default:
      return false;
  }

  setSession(session);
  await interaction.update(buildPayloadForView(session));
  return true;
}

async function handlePatrolManageSelectInteraction(interaction) {
  const parsed = parseInteractionCustomId(interaction.customId, SELECT_PREFIX);
  if (!parsed || !interaction.isStringSelectMenu()) {
    return false;
  }

  const session = await ensureOwnedSession(interaction, parsed.token);
  if (!session) {
    return true;
  }

  if (parsed.action === 'user') {
    session.selectedUserKey = interaction.values?.[0] || null;
    session.selectedLogId = getLogsForUser(session, session.selectedUserKey)[0]?.id || null;
    session.logPage = 0;
    session.view = VIEW_LOGS;
    setSession(session);
    await interaction.update(buildLogListPayload(session));
    return true;
  }

  if (parsed.action === 'log') {
    session.selectedLogId = interaction.values?.[0] || null;
    session.view = VIEW_DETAIL;
    setSession(session);
    await interaction.update(buildLogDetailPayload(session));
    return true;
  }

  return false;
}

async function handlePatrolManageModalInteraction(interaction) {
  const parsed = parseInteractionCustomId(interaction.customId, MODAL_PREFIX);
  if (!parsed || !interaction.isModalSubmit()) {
    return false;
  }

  const session = await ensureOwnedSession(interaction, parsed.token);
  if (!session) {
    return true;
  }

  if (parsed.action === 'search') {
    session.searchQuery = sanitizeText(interaction.fields.getTextInputValue('query'), 100);
    session.userPage = 0;
    session.view = VIEW_USERS;
    setSession(session);
    await replyWithPayload(interaction, buildUserListPayload(session, session.searchQuery ? 'Search applied.' : 'Search updated.'));
    return true;
  }

  if (parsed.action === 'edit') {
    if (!canEditPatrol(interaction)) {
      await interaction.reply({
        content: `You need <@&${getEditRoleId()}> to edit patrol logs.`,
        ephemeral: true,
      }).catch(() => null);
      return true;
    }

    const selectedLog = getSelectedLog(session);
    if (!selectedLog) {
      session.view = VIEW_LOGS;
      setSession(session);
      await replyWithPayload(interaction, buildLogListPayload(session, 'That patrol log is no longer available.'));
      return true;
    }

    const beforeSnapshot = createSnapshot(selectedLog);
    const updatedLog = await updatePatrolLogEntry({
      logId: selectedLog.id,
      rankText: interaction.fields.getTextInputValue('rank_text'),
      startInput: interaction.fields.getTextInputValue('start_time'),
      endInput: interaction.fields.getTextInputValue('end_time'),
      proofUrl: interaction.fields.getTextInputValue('proof_url'),
      notes: interaction.fields.getTextInputValue('notes'),
    });

    appendAuditEntry({
      id: randomUUID(),
      logId: selectedLog.id,
      action: 'edit',
      actorId: interaction.user.id,
      actorTag: interaction.user.tag || interaction.user.username,
      actorMention: `<@${interaction.user.id}>`,
      timestamp: new Date().toISOString(),
      before: beforeSnapshot,
      after: createSnapshot(updatedLog || selectedLog),
    });

    await refreshSessionData(session);
    session.selectedUserKey = normalizeKey(updatedLog?.username || selectedLog.username);
    session.selectedLogId = updatedLog?.id || selectedLog.id;
    session.view = VIEW_DETAIL;
    setSession(session);
    await replyWithPayload(interaction, buildLogDetailPayload(session, 'Patrol updated successfully.'));
    return true;
  }

  return false;
}

module.exports = {
  buildUserListPayload,
  createPatrolManageSession,
  handlePatrolManageButtonInteraction,
  handlePatrolManageModalInteraction,
  handlePatrolManageSelectInteraction,
};
