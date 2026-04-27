const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

const STATE_FILE = path.join(__dirname, '..', 'data', 'tracker-log-state.json');
const DEFAULT_POLL_MS = 10000;
const STATE_LIMIT = 250;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseEmail = process.env.SUPABASE_BOT_EMAIL;
const supabasePassword = process.env.SUPABASE_BOT_PASSWORD;

let authSession = null;

function ensureSupabaseConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Tracker logging is not configured yet. Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.');
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
      strikeIds: uniqueRecent(parsed?.strikeIds),
      arrestIds: uniqueRecent(parsed?.arrestIds),
    };
  } catch {
    return {
      primed: false,
      strikeIds: [],
      arrestIds: [],
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
        strikeIds: uniqueRecent(state?.strikeIds),
        arrestIds: uniqueRecent(state?.arrestIds),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function rememberTrackerRecord(type, id) {
  if (!id) return;

  const state = loadState();
  if (type === 'strike') {
    state.strikeIds = uniqueRecent([...state.strikeIds, id]);
  } else if (type === 'arrest') {
    state.arrestIds = uniqueRecent([...state.arrestIds, id]);
  } else {
    return;
  }

  saveState(state);
}

function sanitizeValue(value, max = 1024) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function formatActorName(value, fallback = 'Unknown') {
  const safeValue = sanitizeValue(value, 120);
  if (!safeValue) return fallback;

  if (safeValue.includes('@') && !safeValue.startsWith('@')) {
    return safeValue.split('@')[0] || fallback;
  }

  return safeValue;
}

function formatTimestamp(value, style = 'f') {
  if (!value) return 'Unknown';

  const unix = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return 'Unknown';

  return `<t:${unix}:${style}>`;
}

function createHeaders(extraHeaders = {}, accessToken) {
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken || supabaseAnonKey}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
}

async function signIn() {
  if (!supabaseEmail || !supabasePassword) {
    authSession = {
      accessToken: supabaseAnonKey,
      refreshToken: null,
      expiresAt: Number.POSITIVE_INFINITY,
    };
    return;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: supabaseEmail,
      password: supabasePassword,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.msg || data?.message || `Supabase auth failed (${response.status})`);
  }

  authSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (Math.max(30, Number(data.expires_in) || 3600) * 1000),
  };
}

async function refreshSession() {
  if (!authSession?.refreshToken) {
    await signIn();
    return;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: authSession.refreshToken,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await signIn();
    return;
  }

  authSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || authSession.refreshToken,
    expiresAt: Date.now() + (Math.max(30, Number(data.expires_in) || 3600) * 1000),
  };
}

async function ensureSession() {
  ensureSupabaseConfig();

  if (!authSession) {
    await signIn();
    return;
  }

  if (authSession.refreshToken && Date.now() >= authSession.expiresAt - 60000) {
    await refreshSession();
  }
}

async function readSupabaseJson(table, {
  query,
  method = 'GET',
  body,
  headers = {},
} = {}) {
  await ensureSession();

  const queryString = query ? `?${query.toString()}` : '';
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${queryString}`, {
    method,
    headers: createHeaders(headers, authSession?.accessToken),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint || `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }

  return data;
}

function normalizeCallsign(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeOfficerUsername(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function arrestDayKey(value) {
  const dt = value ? new Date(value) : new Date();
  if (Number.isNaN(dt.getTime())) return '';

  return dt.getFullYear().toString()
    + String(dt.getMonth() + 1).padStart(2, '0')
    + String(dt.getDate()).padStart(2, '0');
}

function buildArrestCaseNumber(officerUsername, existingLogsForOfficerToday) {
  const officerKey = normalizeOfficerUsername(officerUsername) || 'UNKNOWN';
  const sequence = String((existingLogsForOfficerToday || 0) + 1).padStart(3, '0');
  return `ISP-${arrestDayKey()}-${officerKey}-${sequence}`;
}

function getSingleRow(rows) {
  if (!Array.isArray(rows)) return rows || null;
  return rows[0] || null;
}

async function resolvePersonnelByCallsign(callsign) {
  const safeCallsign = sanitizeValue(callsign, 40);
  if (!safeCallsign) return null;

  const params = new URLSearchParams({
    select: 'id,callsign,roblox_username',
    callsign: `ilike.${safeCallsign}`,
  });

  const rows = await readSupabaseJson('personnel', { query: params });
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }

  const normalizedTarget = normalizeCallsign(safeCallsign);
  const exactMatch = rows.find((row) => normalizeCallsign(row?.callsign) === normalizedTarget);
  if (exactMatch) return exactMatch;

  if (rows.length === 1) return rows[0];

  throw new Error(`Multiple personnel records matched callsign "${safeCallsign}".`);
}

async function resolvePersonnelByDiscordId(discordId) {
  const safeDiscordId = sanitizeValue(discordId, 40);
  if (!safeDiscordId) return null;

  const params = new URLSearchParams({
    select: 'id,callsign,roblox_username,discord_id',
    discord_id: `eq.${safeDiscordId}`,
    limit: '2',
  });

  const rows = await readSupabaseJson('personnel', { query: params });
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }

  if (rows.length > 1) {
    throw new Error(`Multiple personnel records matched Discord ID "${safeDiscordId}".`);
  }

  return rows[0];
}

async function fetchPersonnelById(personnelId) {
  if (!personnelId) return null;

  const params = new URLSearchParams({
    select: 'id,callsign,rank,roblox_username,roblox_id,discord,discord_id,status,category,join_date',
    id: `eq.${personnelId}`,
    limit: '1',
  });

  const rows = await readSupabaseJson('personnel', { query: params });
  return getSingleRow(rows);
}

async function fetchPersonnelRecords(limit = 250) {
  const params = new URLSearchParams({
    select: 'id,callsign,rank,roblox_username,roblox_id,discord,discord_id,status,category,join_date',
    order: 'callsign.asc',
    limit: String(limit),
  });

  const rows = await readSupabaseJson('personnel', { query: params });
  return Array.isArray(rows) ? rows : [];
}

async function updatePersonnelStatusByDiscordId(discordId, status) {
  const safeDiscordId = sanitizeValue(discordId, 40);
  const safeStatus = sanitizeValue(status, 40);

  if (!safeDiscordId) {
    throw new Error('A linked Discord ID is required.');
  }

  if (!safeStatus) {
    throw new Error('A personnel status is required.');
  }

  const personnel = await resolvePersonnelByDiscordId(safeDiscordId);
  if (!personnel?.id) {
    throw new Error('No personnel record was found for that linked Discord account.');
  }

  const rows = await readSupabaseJson('personnel', {
    method: 'PATCH',
    query: new URLSearchParams({
      id: `eq.${personnel.id}`,
      select: 'id,callsign,roblox_username,status,discord_id',
    }),
    headers: {
      Prefer: 'return=representation',
    },
    body: {
      status: safeStatus,
    },
  });

  return getSingleRow(rows) || { ...personnel, status: safeStatus };
}

async function deletePersonnelByDiscordId(discordId) {
  const safeDiscordId = sanitizeValue(discordId, 40);

  if (!safeDiscordId) {
    throw new Error('A linked Discord ID is required.');
  }

  const personnel = await resolvePersonnelByDiscordId(safeDiscordId);
  if (!personnel?.id) {
    throw new Error('No personnel record was found for that linked Discord account.');
  }

  const rows = await readSupabaseJson('personnel', {
    method: 'DELETE',
    query: new URLSearchParams({
      id: `eq.${personnel.id}`,
      select: 'id,callsign,roblox_username,discord_id',
    }),
    headers: {
      Prefer: 'return=representation',
    },
  });

  return getSingleRow(rows) || personnel;
}

async function updatePersonnelRecordById(personnelId, updates = {}) {
  const safePersonnelId = sanitizeValue(personnelId, 60);
  if (!safePersonnelId) {
    throw new Error('A personnel record ID is required.');
  }

  const payload = {};

  if (updates.callsign !== undefined) {
    const safeCallsign = sanitizeValue(updates.callsign, 40);
    if (!safeCallsign) {
      throw new Error('Callsign cannot be empty.');
    }

    const existingByCallsign = await resolvePersonnelByCallsign(safeCallsign);
    if (existingByCallsign?.id && String(existingByCallsign.id) !== safePersonnelId) {
      throw new Error(`Callsign "${safeCallsign}" is already in use on the SAVE tracker.`);
    }

    payload.callsign = safeCallsign;
  }

  if (updates.rank !== undefined) {
    const safeRank = sanitizeValue(updates.rank, 80);
    if (!safeRank) {
      throw new Error('Rank cannot be empty.');
    }

    payload.rank = safeRank;
  }

  if (updates.robloxUsername !== undefined) {
    const safeRobloxUsername = sanitizeValue(updates.robloxUsername, 80);
    if (!safeRobloxUsername) {
      throw new Error('Roblox username cannot be empty.');
    }

    payload.roblox_username = safeRobloxUsername;
  }

  if (updates.robloxId !== undefined) {
    payload.roblox_id = sanitizeValue(updates.robloxId, 40) || null;
  }

  if (updates.discordName !== undefined) {
    payload.discord = sanitizeValue(updates.discordName, 120) || null;
  }

  if (updates.discordId !== undefined) {
    const safeDiscordId = sanitizeValue(updates.discordId, 40);
    if (!safeDiscordId) {
      throw new Error('Discord ID cannot be empty.');
    }

    const existingByDiscord = await resolvePersonnelByDiscordId(safeDiscordId);
    if (existingByDiscord?.id && String(existingByDiscord.id) !== safePersonnelId) {
      throw new Error('That Discord account is already on the SAVE tracker.');
    }

    payload.discord_id = safeDiscordId;
  }

  if (updates.status !== undefined) {
    const safeStatus = sanitizeValue(updates.status, 40);
    if (!safeStatus) {
      throw new Error('Status cannot be empty.');
    }

    payload.status = safeStatus;
  }

  if (updates.category !== undefined) {
    const safeCategory = ['general', 'senior', 'supervisory'].includes(String(updates.category || '').trim().toLowerCase())
      ? String(updates.category).trim().toLowerCase()
      : null;

    if (!safeCategory) {
      throw new Error('Category must be general, senior, or supervisory.');
    }

    payload.category = safeCategory;
  }

  if (!Object.keys(payload).length) {
    throw new Error('No roster updates were provided.');
  }

  const rows = await readSupabaseJson('personnel', {
    method: 'PATCH',
    query: new URLSearchParams({
      id: `eq.${safePersonnelId}`,
      select: 'id,callsign,rank,roblox_username,roblox_id,discord,discord_id,status,category,join_date',
    }),
    headers: {
      Prefer: 'return=representation',
    },
    body: payload,
  });

  return getSingleRow(rows);
}

async function createPersonnelRecord({
  callsign,
  rank,
  robloxUsername,
  robloxId,
  discordName,
  discordId,
  category = 'general',
  status = 'Active',
  joinDate,
}) {
  const safeCallsign = sanitizeValue(callsign, 40);
  const safeRank = sanitizeValue(rank, 80);
  const safeRobloxUsername = sanitizeValue(robloxUsername, 80);
  const safeRobloxId = sanitizeValue(robloxId, 40) || null;
  const safeDiscordName = sanitizeValue(discordName, 120);
  const safeDiscordId = sanitizeValue(discordId, 40);
  const safeCategory = ['general', 'senior', 'supervisory'].includes(String(category || '').trim().toLowerCase())
    ? String(category).trim().toLowerCase()
    : 'general';
  const safeStatus = sanitizeValue(status, 40) || 'Active';
  const safeJoinDate = sanitizeValue(joinDate, 20) || new Date().toISOString().slice(0, 10);

  if (!safeCallsign) {
    throw new Error('Callsign is required.');
  }

  if (!safeRank) {
    throw new Error('Rank is required.');
  }

  if (!safeRobloxUsername) {
    throw new Error('Roblox username is required.');
  }

  if (!safeDiscordId) {
    throw new Error('Discord ID is required.');
  }

  const existingByDiscord = await resolvePersonnelByDiscordId(safeDiscordId);
  if (existingByDiscord?.id) {
    throw new Error('That Discord account is already on the SAVE tracker.');
  }

  const existingByCallsign = await resolvePersonnelByCallsign(safeCallsign);
  if (existingByCallsign?.id) {
    throw new Error(`Callsign "${safeCallsign}" is already in use on the SAVE tracker.`);
  }

  const row = await insertWithRepresentation('personnel', {
    slot_number: '',
    callsign: safeCallsign,
    rank: safeRank,
    status: safeStatus,
    roblox_username: safeRobloxUsername,
    roblox_id: safeRobloxId,
    discord: safeDiscordName || null,
    discord_id: safeDiscordId,
    join_date: safeJoinDate,
    category: safeCategory,
  });

  return row;
}

async function fetchStrikeCount(personnelId) {
  if (!personnelId) return 0;

  const params = new URLSearchParams({
    select: 'id',
    personnel_id: `eq.${personnelId}`,
  });

  const rows = await readSupabaseJson('strikes', { query: params });
  return Array.isArray(rows) ? rows.length : 0;
}

async function insertWithRepresentation(table, payload) {
  const rows = await readSupabaseJson(table, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: payload,
  });

  return getSingleRow(rows);
}

async function insertWithFallback(table, payload, fallbackPayload) {
  try {
    return await insertWithRepresentation(table, payload);
  } catch (error) {
    if (!fallbackPayload || !/column|schema cache|unknown field/i.test(String(error.message || ''))) {
      throw error;
    }

    return insertWithRepresentation(table, fallbackPayload);
  }
}

async function createInfractionRecord({
  callsign,
  discordUserId,
  reason,
  playerUsername,
  supervisorUsername,
}) {
  const safeCallsign = sanitizeValue(callsign, 40);
  const safeDiscordUserId = sanitizeValue(discordUserId, 40);
  const safeReason = sanitizeValue(reason, 1000);
  const safeSupervisorUsername = formatActorName(supervisorUsername, 'Unknown');

  if (!safeCallsign && !safeDiscordUserId) {
    throw new Error('A callsign or linked Discord user is required.');
  }

  if (!safeReason) {
    throw new Error('Reason is required.');
  }

  const personnel = safeDiscordUserId
    ? await resolvePersonnelByDiscordId(safeDiscordUserId)
    : await resolvePersonnelByCallsign(safeCallsign);

  if (!personnel?.id) {
    if (safeDiscordUserId) {
      throw new Error('No personnel record was found for that linked Discord account.');
    }

    throw new Error(`No personnel record was found for callsign "${safeCallsign}".`);
  }

  const strikeCount = (await fetchStrikeCount(personnel.id)) + 1;
  const record = await insertWithRepresentation('strikes', {
    personnel_id: personnel.id,
    reason: safeReason,
    issued_by: safeSupervisorUsername,
  });

  return {
    record,
    personnel,
    strikeCount,
    playerUsername: sanitizeValue(playerUsername, 80) || sanitizeValue(personnel.roblox_username, 80) || 'Unknown',
  };
}

async function countOfficerArrestsToday(officerName) {
  const safeOfficerName = sanitizeValue(officerName, 120);
  if (!safeOfficerName) return 0;

  const params = new URLSearchParams({
    select: 'id,officer_name,created_at',
    officer_name: `ilike.${safeOfficerName}`,
    order: 'created_at.desc',
    limit: '250',
  });

  const rows = await readSupabaseJson('arrests', { query: params });
  const targetKey = normalizeOfficerUsername(safeOfficerName);
  const today = arrestDayKey();

  return (Array.isArray(rows) ? rows : []).filter((row) =>
    normalizeOfficerUsername(row?.officer_name) === targetKey
    && arrestDayKey(row?.created_at) === today,
  ).length;
}

async function createArrestRecord({
  suspectName,
  officerName,
  charge,
  location,
  status,
  notes,
  loggedBy,
}) {
  const safeSuspectName = sanitizeValue(suspectName, 120);
  const safeOfficerName = sanitizeValue(officerName, 120);
  const safeCharge = sanitizeValue(charge, 1000);
  const safeLocation = sanitizeValue(location, 240);
  const safeStatus = sanitizeValue(status || 'Open', 40) || 'Open';
  const safeNotes = sanitizeValue(notes, 1000);
  const safeLoggedBy = formatActorName(loggedBy || officerName, 'Unknown');

  if (!safeSuspectName) {
    throw new Error('Suspect name is required.');
  }

  if (!safeOfficerName) {
    throw new Error('Arresting officer is required.');
  }

  if (!safeCharge) {
    throw new Error('At least one charge is required.');
  }

  const existingLogsToday = await countOfficerArrestsToday(safeOfficerName);
  const caseNumber = buildArrestCaseNumber(safeOfficerName, existingLogsToday);

  const payload = {
    case_number: caseNumber,
    suspect_name: safeSuspectName,
    officer_name: safeOfficerName,
    charge: safeCharge,
    location: safeLocation || null,
    status: safeStatus,
    notes: safeNotes || null,
    logged_by: safeLoggedBy,
  };

  const fallbackPayload = {
    case_number: caseNumber,
    suspect_name: safeSuspectName,
    officer_name: safeOfficerName,
    charge: safeCharge,
    location: safeLocation || null,
    status: safeStatus,
    notes: safeNotes || null,
  };

  const record = await insertWithFallback('arrests', payload, fallbackPayload);

  return {
    record,
    caseNumber,
    loggedBy: sanitizeValue(record?.logged_by, 120) || safeLoggedBy,
  };
}

async function fetchRecentStrikeRecords(limit = 25) {
  const params = new URLSearchParams({
    select: 'id,personnel_id,reason,issued_by,created_at',
    order: 'created_at.desc',
    limit: String(limit),
  });

  const rows = await readSupabaseJson('strikes', { query: params });
  return Array.isArray(rows) ? rows : [];
}

async function fetchRecentArrestRecords(limit = 25) {
  const primaryParams = new URLSearchParams({
    select: 'id,case_number,suspect_name,officer_name,charge,location,status,notes,logged_by,created_at',
    order: 'created_at.desc',
    limit: String(limit),
  });

  try {
    const rows = await readSupabaseJson('arrests', { query: primaryParams });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (!/column|schema cache|unknown field/i.test(String(error.message || ''))) {
      throw error;
    }

    const fallbackParams = new URLSearchParams({
      select: 'id,case_number,suspect_name,officer_name,charge,location,status,notes,created_at',
      order: 'created_at.desc',
      limit: String(limit),
    });

    const rows = await readSupabaseJson('arrests', { query: fallbackParams });
    return Array.isArray(rows) ? rows : [];
  }
}

async function fetchArrestRecordById(arrestId) {
  const safeArrestId = sanitizeValue(arrestId, 80);
  if (!safeArrestId) return null;

  const primaryParams = new URLSearchParams({
    select: 'id,case_number,suspect_name,officer_name,charge,location,status,notes,logged_by,created_at',
    id: `eq.${safeArrestId}`,
    limit: '1',
  });

  try {
    const rows = await readSupabaseJson('arrests', { query: primaryParams });
    return getSingleRow(rows);
  } catch (error) {
    if (!/column|schema cache|unknown field/i.test(String(error.message || ''))) {
      throw error;
    }

    const fallbackParams = new URLSearchParams({
      select: 'id,case_number,suspect_name,officer_name,charge,location,status,notes,created_at',
      id: `eq.${safeArrestId}`,
      limit: '1',
    });

    const rows = await readSupabaseJson('arrests', { query: fallbackParams });
    return getSingleRow(rows);
  }
}

async function updateArrestRecordById(arrestId, updates = {}) {
  const safeArrestId = sanitizeValue(arrestId, 80);
  if (!safeArrestId) {
    throw new Error('An arrest log ID is required.');
  }

  const payload = {};

  if (updates.suspectName !== undefined) {
    const safeSuspectName = sanitizeValue(updates.suspectName, 120);
    if (!safeSuspectName) {
      throw new Error('Suspect name cannot be empty.');
    }
    payload.suspect_name = safeSuspectName;
  }

  if (updates.officerName !== undefined) {
    const safeOfficerName = sanitizeValue(updates.officerName, 120);
    if (!safeOfficerName) {
      throw new Error('Arresting officer cannot be empty.');
    }
    payload.officer_name = safeOfficerName;
  }

  if (updates.charge !== undefined) {
    const safeCharge = sanitizeValue(updates.charge, 1000);
    if (!safeCharge) {
      throw new Error('Charge(s) cannot be empty.');
    }
    payload.charge = safeCharge;
  }

  if (updates.location !== undefined) {
    payload.location = sanitizeValue(updates.location, 240) || null;
  }

  if (updates.status !== undefined) {
    const safeStatus = sanitizeValue(updates.status, 40);
    if (!safeStatus) {
      throw new Error('Status cannot be empty.');
    }
    payload.status = safeStatus;
  }

  if (updates.notes !== undefined) {
    payload.notes = sanitizeValue(updates.notes, 1000) || null;
  }

  if (!Object.keys(payload).length) {
    throw new Error('No arrest updates were provided.');
  }

  const primaryQuery = new URLSearchParams({
    id: `eq.${safeArrestId}`,
    select: 'id,case_number,suspect_name,officer_name,charge,location,status,notes,logged_by,created_at',
  });

  try {
    const rows = await readSupabaseJson('arrests', {
      method: 'PATCH',
      query: primaryQuery,
      headers: {
        Prefer: 'return=representation',
      },
      body: payload,
    });

    return getSingleRow(rows);
  } catch (error) {
    if (!/column|schema cache|unknown field/i.test(String(error.message || '')) || payload.logged_by !== undefined) {
      throw error;
    }

    const fallbackRows = await readSupabaseJson('arrests', {
      method: 'PATCH',
      query: new URLSearchParams({
        id: `eq.${safeArrestId}`,
        select: 'id,case_number,suspect_name,officer_name,charge,location,status,notes,created_at',
      }),
      headers: {
        Prefer: 'return=representation',
      },
      body: payload,
    });

    return getSingleRow(fallbackRows);
  }
}

async function deleteArrestRecordById(arrestId) {
  const safeArrestId = sanitizeValue(arrestId, 80);
  if (!safeArrestId) {
    throw new Error('An arrest log ID is required.');
  }

  const existing = await fetchArrestRecordById(safeArrestId);
  if (!existing?.id) {
    throw new Error('That arrest log could not be found.');
  }

  const rows = await readSupabaseJson('arrests', {
    method: 'DELETE',
    query: new URLSearchParams({
      id: `eq.${safeArrestId}`,
      select: 'id,case_number,suspect_name,officer_name,charge,location,status,notes,created_at',
    }),
    headers: {
      Prefer: 'return=representation',
    },
  });

  return getSingleRow(rows) || existing;
}

function buildStrikeLogEmbed({
  strike,
  personnel,
  strikeCount,
  playerUsername,
}) {
  const safeCallsign = sanitizeValue(personnel?.callsign, 80) || 'Unknown';
  const safePlayerUsername = sanitizeValue(playerUsername, 80)
    || sanitizeValue(personnel?.roblox_username, 80)
    || 'Unknown';
  const safeSupervisorUsername = formatActorName(strike?.issued_by, 'Unknown');
  const safeReason = sanitizeValue(strike?.reason, 1000) || 'No reason provided.';
  const safePersonnelId = sanitizeValue(strike?.personnel_id, 120) || 'Unknown';
  const issuedAt = strike?.created_at;

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`Strike Issued - ${safeCallsign}`)
    .setDescription('A personnel strike has been issued through the SAVE tracker.')
    .addFields(
      { name: 'Callsign', value: safeCallsign, inline: true },
      { name: 'Player Username', value: safePlayerUsername, inline: true },
      { name: 'Strike Count', value: String(strikeCount || 1), inline: true },
      { name: 'Your Username', value: safeSupervisorUsername, inline: false },
      {
        name: 'Issued At',
        value: `${formatTimestamp(issuedAt, 'F')} - ${formatTimestamp(issuedAt, 'R')}`,
        inline: false,
      },
      { name: 'Reason', value: safeReason, inline: false },
    )
    .setFooter({ text: `SAVE Personnel Tracker - Internal ID ${safePersonnelId}` })
    .setTimestamp(issuedAt ? new Date(issuedAt) : new Date());
}

function buildArrestLogEmbed(arrest) {
  const safeCaseNumber = sanitizeValue(arrest?.case_number, 120) || 'Unknown case';
  const safeSuspectName = sanitizeValue(arrest?.suspect_name, 120) || 'Unknown';
  const safeOfficerName = sanitizeValue(arrest?.officer_name, 120) || 'Unknown';
  const safeStatus = sanitizeValue(arrest?.status, 40) || 'Open';
  const safeCharge = sanitizeValue(arrest?.charge, 1000) || 'No charge provided.';
  const safeLocation = sanitizeValue(arrest?.location, 240);
  const safeNotes = sanitizeValue(arrest?.notes, 1000);
  const safeLoggedBy = formatActorName(arrest?.logged_by || arrest?.officer_name, 'Unknown');
  const loggedAt = arrest?.created_at;

  const fields = [
    { name: 'Case #', value: safeCaseNumber, inline: true },
    { name: 'Suspect', value: safeSuspectName, inline: true },
    { name: 'Officer', value: safeOfficerName, inline: true },
    { name: 'Status', value: safeStatus, inline: true },
  ];

  if (safeLocation) {
    fields.push({ name: 'Location', value: safeLocation, inline: true });
  }

  fields.push({ name: 'Charge(s)', value: safeCharge, inline: false });

  if (safeNotes) {
    fields.push({ name: 'Notes', value: safeNotes, inline: false });
  }

  fields.push(
    { name: 'Logged By', value: safeLoggedBy, inline: true },
    {
      name: 'Logged At',
      value: `${formatTimestamp(loggedAt, 'F')} - ${formatTimestamp(loggedAt, 'R')}`,
      inline: false,
    },
  );

  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor({ name: `Arrest Logged - ${safeCaseNumber}` })
    .setDescription([
      'An arrest log has been submitted through the SAVE arrest logger.',
      ...fields.map((field) => `**${field.name}:** ${field.value}`),
    ].join('\n'))
    .setFooter({ text: 'SAVE Arrest Logs - Illinois State Police' })
    .setTimestamp(loggedAt ? new Date(loggedAt) : new Date());
}

async function resolveLogChannel(client, channelId) {
  const channel = client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Tracker log channel ${channelId} was not found or is not text-based.`);
  }

  return channel;
}

async function sendStrikeLogMessage({
  client,
  channelId,
  channel,
  strike,
  personnel,
  strikeCount,
  playerUsername,
}) {
  const resolvedChannel = channel || await resolveLogChannel(client, channelId);
  const resolvedPersonnel = personnel || await fetchPersonnelById(strike?.personnel_id);
  const resolvedStrikeCount = strikeCount || await fetchStrikeCount(strike?.personnel_id);
  const embed = buildStrikeLogEmbed({
    strike,
    personnel: resolvedPersonnel,
    strikeCount: resolvedStrikeCount,
    playerUsername,
  });

  await resolvedChannel.send({ embeds: [embed] });

  if (strike?.id) {
    rememberTrackerRecord('strike', strike.id);
  }
}

async function sendArrestLogMessage({
  client,
  channelId,
  channel,
  arrest,
}) {
  const resolvedChannel = channel || await resolveLogChannel(client, channelId);
  const embed = buildArrestLogEmbed(arrest);

  await resolvedChannel.send({ embeds: [embed] });

  if (arrest?.id) {
    rememberTrackerRecord('arrest', arrest.id);
  }
}

function createTrackerLogNotifier({
  client,
  strikeChannelId,
  arrestChannelId,
  pollMs = DEFAULT_POLL_MS,
}) {
  const state = loadState();
  let timer = null;
  let running = false;
  const effectiveStrikeChannelId = strikeChannelId || arrestChannelId;
  const effectiveArrestChannelId = arrestChannelId || strikeChannelId;

  function isConfigured() {
    return Boolean((effectiveStrikeChannelId || effectiveArrestChannelId) && supabaseUrl && supabaseAnonKey);
  }

  async function primeExisting() {
    const [recentStrikes, recentArrests] = await Promise.all([
      fetchRecentStrikeRecords(),
      fetchRecentArrestRecords(),
    ]);

    state.primed = true;
    state.strikeIds = uniqueRecent([
      ...state.strikeIds,
      ...recentStrikes.map((entry) => entry.id).filter(Boolean),
    ]);
    state.arrestIds = uniqueRecent([
      ...state.arrestIds,
      ...recentArrests.map((entry) => entry.id).filter(Boolean),
    ]);
    saveState(state);
  }

  async function pollOnce() {
    if (running) return;
    running = true;

    try {
      const persistedState = loadState();
      state.primed = state.primed || persistedState.primed;
      state.strikeIds = uniqueRecent([
        ...state.strikeIds,
        ...persistedState.strikeIds,
      ]);
      state.arrestIds = uniqueRecent([
        ...state.arrestIds,
        ...persistedState.arrestIds,
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

      const [strikeChannel, arrestChannel, recentStrikes, recentArrests] = await Promise.all([
        effectiveStrikeChannelId ? resolveLogChannel(client, effectiveStrikeChannelId) : null,
        effectiveArrestChannelId ? resolveLogChannel(client, effectiveArrestChannelId) : null,
        fetchRecentStrikeRecords(),
        fetchRecentArrestRecords(),
      ]);

      const pendingStrikes = recentStrikes
        .filter((entry) => entry?.id && !state.strikeIds.includes(entry.id))
        .reverse();
      const pendingArrests = recentArrests
        .filter((entry) => entry?.id && !state.arrestIds.includes(entry.id))
        .reverse();

      for (const strike of pendingStrikes) {
        await sendStrikeLogMessage({
          channel: strikeChannel,
          strike,
        });
        state.strikeIds = uniqueRecent([...state.strikeIds, strike.id]);
      }

      for (const arrest of pendingArrests) {
        await sendArrestLogMessage({
          channel: arrestChannel,
          arrest,
        });
        state.arrestIds = uniqueRecent([...state.arrestIds, arrest.id]);
      }

      if (pendingStrikes.length || pendingArrests.length) {
        saveState(state);
      }
    } catch (error) {
      console.error('Tracker log notifier failed:', error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (!isConfigured()) {
        console.warn('Tracker log notifier is disabled because one or more env vars are missing.');
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

module.exports = {
  createPersonnelRecord,
  createInfractionRecord,
  createArrestRecord,
  createTrackerLogNotifier,
  deleteArrestRecordById,
  deletePersonnelByDiscordId,
  fetchArrestRecordById,
  fetchPersonnelById,
  fetchPersonnelRecords,
  fetchRecentArrestRecords,
  updatePersonnelStatusByDiscordId,
  updateArrestRecordById,
  updatePersonnelRecordById,
  rememberTrackerRecord,
  resolvePersonnelByDiscordId,
  sendStrikeLogMessage,
  sendArrestLogMessage,
};
