const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const STATE_FILE = path.join(__dirname, '..', 'data', 'patrol-log-state.json');
const DEFAULT_POLL_MS = 10000;
const STATE_LIMIT = 250;
const DEFAULT_QUOTA_MINUTES = Math.max(1, Number(process.env.PATROL_QUOTA_MINUTES) || 120);

function ensureSupabaseConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Patrol logging is not configured yet. Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.');
  }
}

function ensureStateDir() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

function uniqueRecent(values) {
  return Array.from(new Set((values || []).filter(Boolean))).slice(-STATE_LIMIT);
}

function loadState() {
  ensureStateDir();

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      primed: Boolean(parsed?.primed),
      notifiedIds: uniqueRecent(parsed?.notifiedIds),
    };
  } catch {
    return {
      primed: false,
      notifiedIds: [],
    };
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        primed: Boolean(state?.primed),
        notifiedIds: uniqueRecent(state?.notifiedIds),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function rememberPatrolLog(id) {
  if (!id) return;

  const state = loadState();
  state.notifiedIds = uniqueRecent([...state.notifiedIds, id]);
  saveState(state);
}

function normalizePatrolUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function formatRankCode(rankText) {
  const cleaned = String(rankText || '').trim();
  if (!cleaned) return '';

  const normalized = cleaned.replace(/\./g, '').trim().toUpperCase();
  const map = {
    TROOPER: 'T',
    TPR: 'T',
    SERGEANT: 'SGT',
    SGT: 'SGT',
    LIEUTENANT: 'LT',
    LT: 'LT',
    CAPTAIN: 'CPT',
    CPT: 'CPT',
    MAJOR: 'MAJ',
    MAJ: 'MAJ',
    COMMANDER: 'CDR',
    CDR: 'CDR',
    OWNER: 'OWN',
  };

  if (map[normalized]) {
    return map[normalized];
  }

  return normalized.replace(/[^A-Z0-9]/g, '').slice(0, 4) || normalized.slice(0, 1);
}

function buildPatrolLabel(rankCode, username, patrolNumber) {
  const code = String(rankCode || '').trim().toUpperCase() || 'UNIT';
  const name = String(username || '').trim() || 'UNKNOWN';
  const num = Number(patrolNumber) > 0 ? patrolNumber : 1;
  return `${code}, ${name} - PATROL #${num}`;
}

function isDiscordMessageLink(url) {
  return /^https:\/\/(canary\.|ptb\.)?discord(?:app)?\.com\/channels\/\d+\/\d+\/\d+\/?$/i.test(String(url || '').trim());
}

function normalizeTimeString(hours, minutes) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseTimeInput(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Start and end time are required.');
  }

  let hours;
  let minutes;
  let meridiem = null;

  const compactMatch = raw.match(/^(\d{3,4})$/);
  if (compactMatch) {
    const padded = compactMatch[1].padStart(4, '0');
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2, 4));
  } else {
    const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
    if (!match) {
      throw new Error(`Invalid time "${raw}". Use something like 19:00, 1900, 7pm, or 7:30 PM.`);
    }

    hours = Number(match[1]);
    minutes = match[2] ? Number(match[2]) : 0;
    meridiem = match[3] ? match[3].replace(/\./g, '').toLowerCase() : null;
  }

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time "${raw}".`);
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      throw new Error(`Invalid time "${raw}".`);
    }

    if (meridiem === 'pm' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }
  } else if (hours < 0 || hours > 23) {
    throw new Error(`Invalid time "${raw}".`);
  }

  return normalizeTimeString(hours, minutes);
}

function timeStringToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  return (hours * 60) + minutes;
}

function calculatePatrolDurationMinutes(startTime, endTime) {
  const startMinutes = timeStringToMinutes(startTime);
  const endMinutes = timeStringToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) return 0;

  let duration = endMinutes - startMinutes;
  if (duration < 0) duration += 24 * 60;
  return duration;
}

function calculatePatrolDuration(startTime, endTime) {
  const duration = calculatePatrolDurationMinutes(startTime, endTime);
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;

  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function sanitizeValue(value, max = 1024) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function formatTimestamp(value, style = 'f') {
  if (!value) return 'Unknown';

  const unix = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return 'Unknown';

  return `<t:${unix}:${style}>`;
}

function formatDurationMinutes(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function createSupabaseHeaders(extraHeaders = {}) {
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
}

async function readSupabaseJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint || `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }

  return data;
}

async function fetchRecentPatrolLogs(limit = 25) {
  ensureSupabaseConfig();

  const params = new URLSearchParams({
    select: 'id,personnel_id,rank_text,rank_code,username,patrol_number,patrol_label,start_time,end_time,proof_url,notes,logged_by,created_at',
    order: 'created_at.desc',
    limit: String(limit),
  });

  const url = `${supabaseUrl}/rest/v1/shift_logs?${params.toString()}`;
  const rows = await readSupabaseJson(url, {
    method: 'GET',
    headers: createSupabaseHeaders(),
  });

  return Array.isArray(rows) ? rows : [];
}

async function fetchPatrolLogById(logId) {
  ensureSupabaseConfig();

  const safeId = sanitizeValue(logId, 120);
  if (!safeId) return null;

  const params = new URLSearchParams({
    select: 'id,personnel_id,rank_text,rank_code,username,patrol_number,patrol_label,start_time,end_time,proof_url,notes,logged_by,created_at',
    id: `eq.${safeId}`,
    limit: '1',
  });

  const url = `${supabaseUrl}/rest/v1/shift_logs?${params.toString()}`;
  const rows = await readSupabaseJson(url, {
    method: 'GET',
    headers: createSupabaseHeaders(),
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function getNextPatrolNumber(username) {
  const params = new URLSearchParams({
    select: 'username',
    username: `ilike.${String(username || '').trim()}`,
  });

  const url = `${supabaseUrl}/rest/v1/shift_logs?${params.toString()}`;
  const rows = await readSupabaseJson(url, {
    method: 'GET',
    headers: createSupabaseHeaders(),
  });

  return (Array.isArray(rows) ? rows.length : 0) + 1;
}

async function fetchPersonnelByDiscordId(discordId) {
  const safeDiscordId = sanitizeValue(discordId, 40);
  if (!safeDiscordId) return null;

  const params = new URLSearchParams({
    select: 'id,callsign,rank,roblox_username,discord,discord_id',
    discord_id: `eq.${safeDiscordId}`,
    limit: '1',
  });

  const url = `${supabaseUrl}/rest/v1/personnel?${params.toString()}`;
  const rows = await readSupabaseJson(url, {
    method: 'GET',
    headers: createSupabaseHeaders(),
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function fetchPersonnelDirectory(limit = 500) {
  const params = new URLSearchParams({
    select: 'id,callsign,rank,roblox_username,discord,discord_id',
    limit: String(limit),
  });

  const url = `${supabaseUrl}/rest/v1/personnel?${params.toString()}`;
  const rows = await readSupabaseJson(url, {
    method: 'GET',
    headers: createSupabaseHeaders(),
  });

  return Array.isArray(rows) ? rows : [];
}

async function fetchShiftLogsForUsername(username, limit = 500) {
  const safeUsername = String(username || '').trim();
  if (!safeUsername) return [];

  const params = new URLSearchParams({
    select: 'id,username,start_time,end_time,patrol_number,created_at',
    username: `ilike.${safeUsername}`,
    order: 'created_at.desc',
    limit: String(limit),
  });

  const url = `${supabaseUrl}/rest/v1/shift_logs?${params.toString()}`;
  const rows = await readSupabaseJson(url, {
    method: 'GET',
    headers: createSupabaseHeaders(),
  });

  return Array.isArray(rows) ? rows : [];
}

function getChicagoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
  };
}

function chicagoLocalToUtcMs({ year, month, day, hour = 0, minute = 0 }) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute);
  const targetUtcLike = Date.UTC(year, month - 1, day, hour, minute);

  for (let i = 0; i < 4; i += 1) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const map = Object.fromEntries(
      formatter.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]),
    );
    const observedUtcLike = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
    );
    const diff = targetUtcLike - observedUtcLike;
    utcMs += diff;
    if (diff === 0) break;
  }

  return utcMs;
}

function buildCurrentChicagoWeekRange() {
  const parts = getChicagoDateParts(new Date());
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const currentWeekday = weekdayMap[parts.weekday] ?? 0;
  const chicagoTodayUtcMs = chicagoLocalToUtcMs({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
  });
  const startUtcMs = chicagoTodayUtcMs - (currentWeekday * 24 * 60 * 60 * 1000);
  const endUtcMs = startUtcMs + (7 * 24 * 60 * 60 * 1000);

  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
    startUnix: Math.floor(startUtcMs / 1000),
    endUnix: Math.floor(endUtcMs / 1000),
  };
}

async function fetchQuotaCheckByDiscordId(discordId, quotaMinutes = DEFAULT_QUOTA_MINUTES) {
  ensureSupabaseConfig();

  const personnel = await fetchPersonnelByDiscordId(discordId);
  if (!personnel?.roblox_username) {
    throw new Error('No linked personnel record with a Roblox username was found for that member.');
  }

  const weekRange = buildCurrentChicagoWeekRange();
  const logs = await fetchShiftLogsForUsername(personnel.roblox_username);
  const weeklyLogs = logs.filter((log) => {
    const createdAt = log?.created_at ? new Date(log.created_at).getTime() : NaN;
    return Number.isFinite(createdAt)
      && createdAt >= new Date(weekRange.startIso).getTime()
      && createdAt < new Date(weekRange.endIso).getTime();
  });

  const totalMinutes = weeklyLogs.reduce(
    (sum, log) => sum + calculatePatrolDurationMinutes(log?.start_time, log?.end_time),
    0,
  );

  return {
    personnel,
    weeklyLogs,
    totalMinutes,
    totalDuration: formatDurationMinutes(totalMinutes),
    quotaMinutes,
    quotaDuration: formatDurationMinutes(quotaMinutes),
    passed: totalMinutes >= quotaMinutes,
    remainingMinutes: Math.max(0, quotaMinutes - totalMinutes),
    remainingDuration: formatDurationMinutes(Math.max(0, quotaMinutes - totalMinutes)),
    weekRange,
  };
}

async function insertShiftLog(payload) {
  const url = `${supabaseUrl}/rest/v1/shift_logs`;
  const rows = await readSupabaseJson(url, {
    method: 'POST',
    headers: createSupabaseHeaders({
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(payload),
  });

  if (Array.isArray(rows)) {
    return rows[0] || null;
  }

  return rows;
}

async function updatePatrolLogEntry({
  logId,
  rankText,
  startInput,
  endInput,
  proofUrl,
  notes,
}) {
  ensureSupabaseConfig();

  const safeId = sanitizeValue(logId, 120);
  if (!safeId) {
    throw new Error('A patrol log ID is required.');
  }

  const existing = await fetchPatrolLogById(safeId);
  if (!existing) {
    throw new Error('That patrol log could not be found anymore.');
  }

  const safeRankText = String(rankText || existing.rank_text || existing.rank_code || '').trim();
  const safeProofUrl = String(proofUrl || existing.proof_url || '').trim();
  const safeNotes = String(notes || '').trim();

  if (!safeRankText) {
    throw new Error('Rank is required.');
  }

  if (!safeProofUrl) {
    throw new Error('Proof link is required.');
  }

  if (!isDiscordMessageLink(safeProofUrl)) {
    throw new Error('Proof link must be a full Discord message link.');
  }

  const startTime = parseTimeInput(startInput || existing.start_time);
  const endTime = parseTimeInput(endInput || existing.end_time);
  const durationMinutes = calculatePatrolDurationMinutes(startTime, endTime);

  if (durationMinutes <= 0) {
    throw new Error('Start and end time must create a valid patrol window.');
  }

  const rankCode = formatRankCode(safeRankText);
  const patrolLabel = buildPatrolLabel(rankCode, existing.username, existing.patrol_number);
  const url = `${supabaseUrl}/rest/v1/shift_logs?id=eq.${encodeURIComponent(safeId)}`;
  const rows = await readSupabaseJson(url, {
    method: 'PATCH',
    headers: createSupabaseHeaders({
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({
      rank_text: safeRankText,
      rank_code: rankCode,
      patrol_label: patrolLabel,
      start_time: startTime,
      end_time: endTime,
      proof_url: safeProofUrl,
      notes: safeNotes,
    }),
  });

  if (Array.isArray(rows)) {
    return rows[0] || null;
  }

  return rows;
}

async function deletePatrolLogEntry(logId) {
  ensureSupabaseConfig();

  const safeId = sanitizeValue(logId, 120);
  if (!safeId) {
    throw new Error('A patrol log ID is required.');
  }

  const url = `${supabaseUrl}/rest/v1/shift_logs?id=eq.${encodeURIComponent(safeId)}`;
  const rows = await readSupabaseJson(url, {
    method: 'DELETE',
    headers: createSupabaseHeaders({
      Prefer: 'return=representation',
    }),
  });

  if (Array.isArray(rows)) {
    return rows[0] || null;
  }

  return rows;
}

function buildPatrolLogEmbed(log) {
  const patrolLabel = sanitizeValue(log?.patrol_label, 120) || 'Unknown patrol';
  const rank = sanitizeValue(log?.rank_text || log?.rank_code, 80) || 'Unknown';
  const username = sanitizeValue(log?.username, 80) || 'Unknown';
  const startTime = sanitizeValue(log?.start_time, 20) || 'Unknown';
  const endTime = sanitizeValue(log?.end_time, 20) || 'Unknown';
  const duration = calculatePatrolDuration(log?.start_time, log?.end_time);
  const proofUrl = sanitizeValue(log?.proof_url, 900);
  const notes = sanitizeValue(log?.notes, 1000);
  const loggedBy = sanitizeValue(log?.logged_by, 120) || 'Unknown';
  const createdAt = log?.created_at;
  const patrolNumber = Number(log?.patrol_number) > 0 ? String(log.patrol_number) : 'Unknown';
  const internalId = sanitizeValue(log?.id, 120) || 'Unknown';
  const source = log?.personnel_id ? 'SAVE Tracker Website' : 'Discord /patrol Command';

  const embed = new EmbedBuilder()
    .setColor(0x4a9fd4)
    .setTitle(`Patrol Logged - ${patrolLabel}`)
    .setDescription('A patrol log has been submitted through the SAVE patrol logger.')
    .addFields(
      { name: 'Source', value: source, inline: true },
      { name: 'Patrol #', value: patrolNumber, inline: true },
      { name: 'Rank', value: rank, inline: true },
      { name: 'Username', value: username, inline: true },
      { name: 'Window', value: `${startTime} - ${endTime}`, inline: true },
      { name: 'Duration', value: duration, inline: true },
      { name: 'Proof', value: proofUrl ? `[Open Proof Message](${proofUrl})` : 'No proof provided', inline: false },
      { name: 'Logged By', value: loggedBy, inline: true },
      {
        name: 'Logged At',
        value: `${formatTimestamp(createdAt, 'F')} - ${formatTimestamp(createdAt, 'R')}`,
        inline: false,
      },
    )
    .setFooter({ text: `SAVE Patrol Logs - Internal ID ${internalId}` })
    .setTimestamp(createdAt ? new Date(createdAt) : new Date());

  if (notes) {
    embed.addFields({ name: 'Notes', value: notes, inline: false });
  }

  return embed;
}

async function resolveLogChannel(client, channelId) {
  const channel = client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Patrol log channel ${channelId} was not found or is not text-based.`);
  }

  return channel;
}

async function sendPatrolLogMessage({
  client,
  channelId,
  channel,
  log,
}) {
  const resolvedChannel = channel || await resolveLogChannel(client, channelId);
  const embed = buildPatrolLogEmbed(log);

  await resolvedChannel.send({ embeds: [embed] });

  if (log?.id) {
    rememberPatrolLog(log.id);
  }
}

function createPatrolLogNotifier({
  client,
  channelId,
  pollMs = DEFAULT_POLL_MS,
}) {
  const state = loadState();
  let timer = null;
  let running = false;

  function isConfigured() {
    return Boolean(channelId && supabaseUrl && supabaseAnonKey);
  }

  async function primeExisting() {
    const recent = await fetchRecentPatrolLogs();
    state.primed = true;
    state.notifiedIds = uniqueRecent([
      ...state.notifiedIds,
      ...recent.map((entry) => entry.id).filter(Boolean),
    ]);
    saveState(state);
  }

  async function pollOnce() {
    if (running) return;
    running = true;

    try {
      const persistedState = loadState();
      state.primed = state.primed || persistedState.primed;
      state.notifiedIds = uniqueRecent([
        ...state.notifiedIds,
        ...persistedState.notifiedIds,
      ]);

      if (!isConfigured()) {
        running = false;
        return;
      }

      if (!state.primed) {
        await primeExisting();
        running = false;
        return;
      }

      const [channel, recent] = await Promise.all([
        resolveLogChannel(client, channelId),
        fetchRecentPatrolLogs(),
      ]);

      const pending = recent
        .filter((entry) => entry?.id && !state.notifiedIds.includes(entry.id))
        .reverse();

      for (const log of pending) {
        await sendPatrolLogMessage({
          channel,
          log,
        });
        state.notifiedIds = uniqueRecent([...state.notifiedIds, log.id]);
      }

      if (pending.length) {
        saveState(state);
      }
    } catch (error) {
      console.error('Patrol log notifier failed:', error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (!isConfigured()) {
        console.warn('Patrol log notifier is disabled because one or more env vars are missing.');
        return;
      }

      if (timer) return;

      void pollOnce();
      timer = setInterval(() => {
        void pollOnce();
      }, Math.max(5000, Number(pollMs) || DEFAULT_POLL_MS));
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

async function createPatrolLog({
  rankText,
  username,
  startInput,
  endInput,
  proofUrl,
  notes,
  loggedBy,
}) {
  ensureSupabaseConfig();

  const safeRankText = String(rankText || '').trim();
  const safeUsername = String(username || '').trim();
  const safeProofUrl = String(proofUrl || '').trim();
  const safeNotes = String(notes || '').trim();

  if (!safeRankText) {
    throw new Error('Rank is required.');
  }

  if (!safeUsername) {
    throw new Error('Username is required.');
  }

  if (!safeProofUrl) {
    throw new Error('Proof link is required.');
  }

  if (!isDiscordMessageLink(safeProofUrl)) {
    throw new Error('Proof link must be a full Discord message link.');
  }

  const startTime = parseTimeInput(startInput);
  const endTime = parseTimeInput(endInput);
  const durationMinutes = calculatePatrolDurationMinutes(startTime, endTime);

  if (durationMinutes <= 0) {
    throw new Error('Start and end time must create a valid patrol window.');
  }

  const patrolNumber = await getNextPatrolNumber(safeUsername);
  const rankCode = formatRankCode(safeRankText);
  const patrolLabel = buildPatrolLabel(rankCode, safeUsername, patrolNumber);

  const insertedLog = await insertShiftLog({
    personnel_id: null,
    rank_text: safeRankText,
    rank_code: rankCode,
    username: safeUsername,
    patrol_number: patrolNumber,
    patrol_label: patrolLabel,
    start_time: startTime,
    end_time: endTime,
    proof_url: safeProofUrl,
    notes: safeNotes,
    logged_by: String(loggedBy || 'Discord command').trim(),
  });

  return {
    insertedLog,
    patrolLabel,
    patrolNumber,
    rankCode,
    startTime,
    endTime,
    duration: calculatePatrolDuration(startTime, endTime),
    usernameKey: normalizePatrolUsername(safeUsername),
  };
}

module.exports = {
  calculatePatrolDuration,
  createPatrolLog,
  createPatrolLogNotifier,
  deletePatrolLogEntry,
  fetchPersonnelDirectory,
  fetchRecentPatrolLogs,
  fetchQuotaCheckByDiscordId,
  sendPatrolLogMessage,
  updatePatrolLogEntry,
};
