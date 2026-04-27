const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

const STATE_FILE = path.join(__dirname, '..', 'data', 'application-notifier-state.json');
const DEFAULT_POLL_MS = 15000;

function ensureStateDir() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

function loadState() {
  ensureStateDir();

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      primed: Boolean(parsed?.primed),
      notifiedIds: Array.isArray(parsed?.notifiedIds) ? parsed.notifiedIds.slice(-250) : [],
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
        primed: Boolean(state.primed),
        notifiedIds: Array.isArray(state.notifiedIds) ? state.notifiedIds.slice(-250) : [],
      },
      null,
      2,
    ),
    'utf8',
  );
}

function formatTimestamp(value, style = 'f') {
  if (!value) return 'Unknown';

  const unix = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return 'Unknown';

  return `<t:${unix}:${style}>`;
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}m`;
  return `${remainingSeconds}s`;
}

function buildSubmissionEmbed(submission) {
  const submitted = submission.status === 'submitted';
  const color = submitted ? 0x57f287 : 0xed4245;
  const title = submitted ? 'Application Submitted' : 'Application Locked';
  const scoreLine = submitted
    ? `${submission.correct_count ?? 0}/${submission.total_questions ?? 0} correct (${submission.score_percent ?? 0}%)`
    : 'Not graded';

  const descriptionLines = [
    submitted
      ? '> A new application has been submitted through the secure portal.'
      : '> A secure application session ended in a locked state.',
    '',
    `> **Applicant:** ${submission.applicant_name || 'Unknown Applicant'}`,
    `> **Roblox:** ${submission.roblox_username || 'Unknown'}`,
    `> **Discord:** ${submission.discord_tag || 'Unknown'}`,
    `> **Department:** ${submission.department || 'Unknown'}`,
  ];

  if (!submitted && submission.terminated_reason) {
    descriptionLines.push(`> **Lock Reason:** ${submission.terminated_reason}`);
  }

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: title })
    .setDescription([
      ...descriptionLines,
      '',
      `**Status:** ${submitted ? 'Submitted' : 'Terminated'}`,
      `**Warnings:** ${String(submission.warning_count ?? 0)}`,
      `**Duration:** ${formatDuration(submission.duration_seconds)}`,
      `**Score:** ${scoreLine}`,
      `**Started:** ${formatTimestamp(submission.started_at, 'f')} (${formatTimestamp(submission.started_at, 'R')})`,
      `**Finished:** ${formatTimestamp(submission.finished_at || submission.submitted_at, 'f')} (${formatTimestamp(submission.finished_at || submission.submitted_at, 'R')})`,
      `**Session ID:** \`${submission.session_id || 'unknown'}\``,
    ].join('\n'))
    .setFooter({ text: 'SAVE Secure Application Portal' })
    .setTimestamp(new Date(submission.submitted_at || submission.finished_at || Date.now()));
}

function createSubmissionNotifier({
  client,
  channelId,
  supabaseUrl,
  supabaseAnonKey,
  supabaseEmail,
  supabasePassword,
  pollMs = DEFAULT_POLL_MS,
}) {
  const state = loadState();
  let timer = null;
  let running = false;
  let authSession = null;

  function isConfigured() {
    return Boolean(channelId && supabaseUrl && supabaseAnonKey && supabaseEmail && supabasePassword);
  }

  async function signIn() {
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
    if (!authSession) {
      await signIn();
      return;
    }

    if (Date.now() >= authSession.expiresAt - 60000) {
      await refreshSession();
    }
  }

  async function fetchRecentSubmissions() {
    await ensureSession();

    const params = new URLSearchParams({
      select: 'session_id,applicant_name,discord_tag,roblox_username,department,status,started_at,finished_at,submitted_at,duration_seconds,warning_count,terminated_reason,score_percent,correct_count,total_questions',
      order: 'submitted_at.desc',
      limit: '25',
    });

    const response = await fetch(`${supabaseUrl}/rest/v1/assessment_submissions?${params.toString()}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${authSession.accessToken}`,
      },
    });

    const data = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(data?.message || data?.msg || `Supabase submission fetch failed (${response.status})`);
    }

    return Array.isArray(data) ? data : [];
  }

  async function resolveChannel() {
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Application log channel ${channelId} was not found or is not text-based.`);
    }

    return channel;
  }

  async function primeExisting() {
    const recent = await fetchRecentSubmissions();
    state.primed = true;
    state.notifiedIds = recent
      .map((submission) => submission.session_id)
      .filter(Boolean)
      .slice(0, 250);
    saveState(state);
  }

  async function pollOnce() {
    if (running) return;
    running = true;

    try {
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
        resolveChannel(),
        fetchRecentSubmissions(),
      ]);

      const pending = recent
        .filter((submission) => submission?.session_id && !state.notifiedIds.includes(submission.session_id))
        .reverse();

      for (const submission of pending) {
        await channel.send({ embeds: [buildSubmissionEmbed(submission)] });
        state.notifiedIds.push(submission.session_id);
      }

      if (pending.length) {
        state.notifiedIds = state.notifiedIds.slice(-250);
        saveState(state);
      }
    } catch (error) {
      console.error('Application submission notifier failed:', error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (!isConfigured()) {
        console.warn('Application submission notifier is disabled because one or more env vars are missing.');
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
  createSubmissionNotifier,
};
