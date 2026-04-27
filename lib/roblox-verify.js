const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { sendUserNotification } = require('./notification-utils');

const DEFAULT_POLL_MS = 10000;
const VERIFIED_ROLE_ID = process.env.ROBLOX_VERIFIED_ROLE_ID || process.env.DISCORD_VERIFIED_ROLE_ID || '';
const VERIFY_BASE_URL = String(process.env.ROBLOX_VERIFY_BASE_URL || '').replace(/\/+$/, '');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseEmail = process.env.SUPABASE_BOT_EMAIL;
const supabasePassword = process.env.SUPABASE_BOT_PASSWORD;

let authSession = null;

function ensureSupabaseConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Roblox verification is not configured yet. Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.');
  }
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

function createVerifyState() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeNickname(username) {
  const base = `@${String(username || '').trim()}`.slice(0, 32);
  return base || null;
}

function buildVerifyUrl(state) {
  if (!VERIFY_BASE_URL) {
    return '';
  }

  return `${VERIFY_BASE_URL}/api/roblox/login?state=${encodeURIComponent(state)}`;
}

async function createVerificationSession({ discordUserId, discordUsername, guildId }) {
  const state = createVerifyState();
  const expiresAt = new Date(Date.now() + (15 * 60 * 1000)).toISOString();

  await readSupabaseJson('roblox_verification_sessions', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: {
      state,
      discord_user_id: String(discordUserId),
      discord_username: String(discordUsername || ''),
      guild_id: String(guildId || ''),
      status: 'pending',
      expires_at: expiresAt,
    },
  });

  return {
    state,
    expiresAt,
    url: buildVerifyUrl(state),
  };
}

function buildVerifyPrompt({ url }) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle('Roblox Verification')
    .setDescription(
      [
        'Use the button below to link your Roblox account.',
        '',
        '> Sign into Roblox and select the account you want linked.',
        '> After approval, your Discord nickname will become your Roblox username.',
        `> The verified role <@&${VERIFIED_ROLE_ID || 'UNKNOWN'}> will be added automatically.`,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'What Happens Next',
        value: 'Once Roblox returns your account, SAVE Assistant will finish the role and nickname update automatically.',
        inline: false,
      },
      {
        name: 'Duplicate Accounts',
        value: 'Duplicate Roblox links are flagged for review, but they are not blocked.',
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant Roblox Verification' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Verify With Roblox')
      .setStyle(ButtonStyle.Link)
      .setURL(url || 'https://example.com'),
  );

  return { embed, row };
}

async function applyVerification(client, session) {
  const guildId = String(session.guild_id || process.env.GUILD_ID || '');
  if (!guildId) {
    throw new Error('Missing guild id for Roblox verification processing.');
  }

  if (!VERIFIED_ROLE_ID) {
    throw new Error('Missing ROBLOX_VERIFIED_ROLE_ID or DISCORD_VERIFIED_ROLE_ID in .env.');
  }

  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(String(session.discord_user_id));
  const nickname = normalizeNickname(session.roblox_username);

  if (nickname && member.manageable && member.nickname !== nickname) {
    await member.setNickname(nickname, 'SAVE Roblox verification completed').catch(() => null);
  }

  if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
    await member.roles.add(VERIFIED_ROLE_ID, 'SAVE Roblox verification completed');
  }

  await sendUserNotification({
    client,
    user: member.user,
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Roblox Linked')
        .setDescription(
          [
            `Your Roblox account has been linked as **${session.roblox_username || 'Unknown'}**.`,
            '',
            '> Your nickname and verified role were updated in the server.',
            session.duplicate_flag
              ? '> This Roblox account was also flagged as a duplicate link for staff review.'
              : '> No duplicate Roblox link was detected during this verification.',
          ].join('\n'),
        )
        .setFooter({ text: 'SAVE Assistant Verification' })
        .setTimestamp(),
    ],
    fallbackPrefix: 'Roblox verification DM delivery failed. Posting here instead.',
  }).catch(() => null);

  return {
    nicknameApplied: nickname,
  };
}

async function markProcessed(sessionId, payload = {}) {
  if (!sessionId) return;

  await readSupabaseJson('roblox_verification_sessions', {
    method: 'PATCH',
    query: new URLSearchParams({
      id: `eq.${sessionId}`,
    }),
    headers: {
      Prefer: 'return=minimal',
    },
    body: {
      ...payload,
      status: payload.status || 'processed',
      processed_at: new Date().toISOString(),
    },
  });
}

async function fetchCompletedSessions() {
  const params = new URLSearchParams({
    select: 'id,state,discord_user_id,discord_username,guild_id,roblox_user_id,roblox_username,roblox_display_name,duplicate_flag,duplicate_count,completed_at,expires_at,status',
    status: 'eq.completed',
    order: 'completed_at.asc',
    limit: '20',
  });

  return readSupabaseJson('roblox_verification_sessions', { query: params });
}

function createRobloxVerificationNotifier({ client, pollMs }) {
  const intervalMs = Math.max(3000, Number(pollMs) || DEFAULT_POLL_MS);
  let timer = null;
  let active = false;

  async function tick() {
    if (active) return;
    active = true;

    try {
      const sessions = await fetchCompletedSessions();
      for (const session of Array.isArray(sessions) ? sessions : []) {
        try {
          await applyVerification(client, session);
          await markProcessed(session.id, { status: 'processed' });
        } catch (error) {
          await markProcessed(session.id, {
            status: 'failed',
            error_message: String(error?.message || 'Unknown Roblox verification processing error.').slice(0, 400),
          }).catch(() => null);
        }
      }
    } catch (error) {
      console.error('Roblox verification notifier failed:', error);
    } finally {
      active = false;
    }
  }

  return {
    isEnabled() {
      return Boolean(supabaseUrl && supabaseAnonKey);
    },
    start() {
      if (timer) return;
      if (!this.isEnabled()) {
        console.warn('Roblox verification notifier is disabled because Supabase env vars are missing.');
        return;
      }

      void tick();
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    },
  };
}

module.exports = {
  VERIFIED_ROLE_ID,
  VERIFY_BASE_URL,
  buildVerifyPrompt,
  createVerificationSession,
  createRobloxVerificationNotifier,
};
