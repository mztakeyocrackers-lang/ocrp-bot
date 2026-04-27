const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const APPLICATION_LOG_CHANNEL_ID = '1465136666791383254';
const APPLICATION_REVIEW_FORUM_ID = '1498226932863729735';
const APPLICATION_ALERT_CHANNEL_ID = '1467048011514515562';
const APPLICATION_ALERT_ROLE_ID = '1465136661187924105';
const SAVE_INFO_CHANNEL_URL = 'https://discord.com/channels/1465136660533612798/1467024034414985439';
const ROLE_REQUEST_CHANNEL_URL = 'https://discord.com/channels/1465136660533612798/1497858144368459806';
const APPLICATIONS_CHANNEL_URL = 'https://discord.com/channels/1465136660533612798/1480050430560960563';
const TICKETS_CHANNEL_URL = 'https://discord.com/channels/1465136660533612798/1465136665185095684';
const GENERAL_CHAT_CHANNEL_URL = 'https://discord.com/channels/1465136660533612798/1465136663461105699';
const APPLICATION_COMPLETION_BANNER_URL = 'https://www.image2url.com/r2/default/images/1777283857711-2b22b034-1b66-43a6-9f1e-2884c7800863.png';
const SESSIONS_PATH = path.join(__dirname, '..', 'data', 'dm-application-sessions.json');
const DM_APPLICATION_BEGIN_ID = 'dm_application:begin';
const DM_APPLICATION_CANCEL_ID = 'dm_application:cancel';
const DM_APPLICATION_CONFIRM_ID = 'dm_application:confirm';
const DM_APPLICATION_REFRESH_ID = 'dm_application:refresh';
const DM_APPLICATION_BACK_ID = 'dm_application:back';
const DM_APPLICATION_BACK_MODAL_ID = 'dm_application:back_modal';
const TOTAL_APPLICATION_MS = 120 * 60 * 1000;
const QUESTION_TIMEOUT_MS = 8 * 60 * 1000;
const GO_BACK_MIN_MS = 15 * 1000;

const QUESTIONS = [
  'Walk through what a good SAVE shift looks like from start to finish.',
  'Describe a traffic stop that starts simple but turns more serious. What would make you slow down or call for backup?',
  'Tell me about a time you stayed calm while someone was disrespectful or trying to bait you.',
  'What would you do if another trooper wanted to cut corners during a SAVE shift?',
  'What is the difference between proactive enforcement and aggressive enforcement?',
  'If SAVE is asked to help in a high-crime area, what would you want to know before starting?',
  'What does professionalism look like when dealing with someone you do not like or trust?',
  'How would you write a strong report after a stop, search, or arrest?',
  'Give an example of when doing less police work would actually be the right choice.',
  'If you recover a firearm during an arrest, what are your first priorities?',
  'What would you do if a respected partner made a bad call on scene?',
  'How do you balance officer safety with constitutional limits during a tense stop?',
  'Why are you a good fit for SAVE specifically, not just regular patrol?',
  'How would you explain SAVE to someone who thinks the unit is just aggressive?',
  'What kind of teammate becomes a liability on a proactive team?',
  'Tell me about a time patience worked better than force or speed.',
  'How do you stay sharp during a slow deployment without forcing police work?',
  'How do you tell the difference between a real criminal indicator and something that only looks suspicious?',
  'What responsibilities matter after an arrest scene is over?',
  'If a supervisor asked why you want SAVE, what would you honestly say?',
  'How would you handle a citizen complaint after a stop you believe was lawful?',
  'What are the risks of ego in a unit like SAVE, and how would you keep yours in check?',
  'What signs would show that a newer trooper is not ready for proactive anti-violence work?',
  'What makes radio communication useful during a deployment?',
  'What would you do if a long shift left you tired and frustrated, but the work was still going?',
  'What kind of judgment should someone in SAVE have?',
  'What would you do if a case was weak, but people around you still wanted it to stick?',
  'What does command presence mean to you?',
  'What would make you trust a teammate more, and what would make you lose confidence in them?',
  'Why should SAVE trust you with this assignment?',
];

function ensureSessionStore() {
  const dir = path.dirname(SESSIONS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(SESSIONS_PATH)) {
    fs.writeFileSync(SESSIONS_PATH, '{}', 'utf8');
  }
}

function loadSessions() {
  ensureSessionStore();

  try {
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
  } catch (error) {
    console.error('Failed to read DM application sessions:', error);
    return {};
  }
}

function saveSessions(sessions) {
  ensureSessionStore();
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf8');
}

function getSession(userId) {
  const sessions = loadSessions();
  return sessions[userId] || null;
}

function setSession(userId, session) {
  const sessions = loadSessions();
  sessions[userId] = session;
  saveSessions(sessions);
}

function clearSession(userId) {
  const sessions = loadSessions();
  delete sessions[userId];
  saveSessions(sessions);
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return 'Unknown';
  }

  const date = new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function formatRelativeTimestamp(isoString) {
  if (!isoString) {
    return 'Unknown';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function formatRemainingDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatEasternDateTime(isoString) {
  if (!isoString) {
    return 'Unknown';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

function buildDeadlineIso(baseIso, durationMs) {
  const baseMs = new Date(baseIso).getTime();
  const safeBaseMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(safeBaseMs + durationMs).toISOString();
}

function ensureQuestionDeadlines(session) {
  if (!session) {
    return session;
  }

  if (!Array.isArray(session.questionDeadlines)) {
    session.questionDeadlines = [];
  }

  if (!Array.isArray(session.questionRemainingMs)) {
    session.questionRemainingMs = [];
  }

  return session;
}

function getQuestionDeadlineAt(session, questionIndex) {
  ensureQuestionDeadlines(session);
  return session.questionDeadlines[questionIndex] || null;
}

function getQuestionRemainingMs(session, questionIndex) {
  ensureQuestionDeadlines(session);

  const safeQuestionIndex = Math.max(0, Number(questionIndex) || 0);
  const currentIndex = Math.max(0, Number(session?.currentQuestionIndex) || 0);

  if (session?.status === 'active' && safeQuestionIndex === currentIndex) {
    const deadlineMs = new Date(session.questionDeadlines[safeQuestionIndex] || session.questionDeadlineAt || 0).getTime();
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
      return 0;
    }

    return deadlineMs - Date.now();
  }

  const frozenRemainingMs = Number(session.questionRemainingMs[safeQuestionIndex]);
  if (Number.isFinite(frozenRemainingMs) && frozenRemainingMs > 0) {
    return frozenRemainingMs;
  }

  const legacyDeadlineMs = new Date(getQuestionDeadlineAt(session, safeQuestionIndex) || 0).getTime();
  if (!Number.isFinite(legacyDeadlineMs) || legacyDeadlineMs <= 0) {
    return 0;
  }

  return Math.max(0, legacyDeadlineMs - Date.now());
}

function canGoBackQuestion(session) {
  if (!session || session.status !== 'active' || session.currentQuestionIndex <= 0 || session.goBackState) {
    return false;
  }

  return getQuestionRemainingMs(session, session.currentQuestionIndex - 1) > GO_BACK_MIN_MS;
}

function syncCurrentQuestionDeadline(session) {
  if (!session) {
    return session;
  }

  ensureQuestionDeadlines(session);

  if (session.status !== 'active') {
    session.questionDeadlineAt = null;
    return session;
  }

  const currentIndex = Math.max(0, Number(session.currentQuestionIndex) || 0);
  const frozenRemainingMs = Math.max(0, Number(session.questionRemainingMs[currentIndex]) || 0);
  let currentDeadline = session.questionDeadlines[currentIndex] || null;

  if (!currentDeadline) {
    if (frozenRemainingMs > 0) {
      currentDeadline = new Date(Date.now() + frozenRemainingMs).toISOString();
    } else if (session.questionDeadlineAt) {
      currentDeadline = session.questionDeadlineAt;
    } else {
      currentDeadline = new Date(Date.now() + QUESTION_TIMEOUT_MS).toISOString();
    }
  }

  session.questionDeadlines[currentIndex] = currentDeadline;
  session.questionRemainingMs[currentIndex] = Math.max(0, new Date(currentDeadline).getTime() - Date.now());
  session.questionDeadlineAt = currentDeadline;
  return session;
}

function normalizeSessionTiming(session) {
  if (!session || !['active', 'review', 'completed', 'cancelled'].includes(session.status)) {
    return session;
  }

  if (!session.applicationStartedAt) {
    session.applicationStartedAt = session.startedAt || new Date().toISOString();
  }

  if (!session.totalDeadlineAt) {
    session.totalDeadlineAt = buildDeadlineIso(session.applicationStartedAt, TOTAL_APPLICATION_MS);
  }

  if (session.status === 'active') {
    syncCurrentQuestionDeadline(session);
  } else {
    session.questionDeadlineAt = null;
  }

  return session;
}

function markSessionStarted(session) {
  const nowIso = new Date().toISOString();
  session.status = 'active';
  session.currentQuestionIndex = 0;
  session.applicationStartedAt = nowIso;
  session.totalDeadlineAt = buildDeadlineIso(nowIso, TOTAL_APPLICATION_MS);
  session.questionDeadlines = [new Date(Date.now() + QUESTION_TIMEOUT_MS).toISOString()];
  session.questionRemainingMs = [QUESTION_TIMEOUT_MS];
  session.questionDeadlineAt = session.questionDeadlines[0];
  return session;
}

function freezeCurrentQuestionRemaining(session) {
  if (!session || session.status !== 'active') {
    return session;
  }

  ensureQuestionDeadlines(session);

  const currentIndex = Math.max(0, Number(session.currentQuestionIndex) || 0);
  const currentDeadlineMs = new Date(session.questionDeadlines[currentIndex] || session.questionDeadlineAt || 0).getTime();
  session.questionRemainingMs[currentIndex] = Number.isFinite(currentDeadlineMs) && currentDeadlineMs > 0
    ? Math.max(0, currentDeadlineMs - Date.now())
    : 0;
  session.questionDeadlines[currentIndex] = null;
  session.questionDeadlineAt = null;

  return session;
}

function advanceQuestionTimer(session) {
  ensureQuestionDeadlines(session);

  const currentIndex = Math.max(0, Number(session.currentQuestionIndex) || 0);
  if (!session.questionDeadlines[currentIndex]) {
    const frozenRemainingMs = Math.max(0, Number(session.questionRemainingMs[currentIndex]) || 0);
    session.questionDeadlines[currentIndex] = new Date(Date.now() + (frozenRemainingMs > 0 ? frozenRemainingMs : QUESTION_TIMEOUT_MS)).toISOString();
  }

  session.questionDeadlineAt = session.questionDeadlines[currentIndex];
  return syncCurrentQuestionDeadline(session);
}

function moveSessionToReview(session) {
  session.status = 'review';
  session.questionDeadlineAt = null;
  return session;
}

function hasTotalSessionExpired(session) {
  const totalDeadlineMs = new Date(session?.totalDeadlineAt || 0).getTime();
  return Number.isFinite(totalDeadlineMs) && Date.now() > totalDeadlineMs;
}

function hasCurrentQuestionExpired(session) {
  if (!session || session.status !== 'active') {
    return false;
  }

  const questionDeadlineMs = new Date(session.questionDeadlineAt || 0).getTime();
  return Number.isFinite(questionDeadlineMs) && Date.now() > questionDeadlineMs;
}

function getSessionTimeoutReason(session) {
  if (!session || !['active', 'review'].includes(session.status)) {
    return null;
  }

  if (hasTotalSessionExpired(session)) {
    return 'The 120-minute total application limit expired.';
  }

  if (hasCurrentQuestionExpired(session)) {
    return 'The 8-minute limit for the current question expired.';
  }

  return null;
}

function buildTimingField(session) {
  const normalized = normalizeSessionTiming({ ...session });
  const now = Date.now();
  const totalDeadlineMs = new Date(normalized.totalDeadlineAt || 0).getTime();
  const questionDeadlineMs = new Date(normalized.questionDeadlineAt || 0).getTime();

  const lines = [];

  if (Number.isFinite(totalDeadlineMs) && totalDeadlineMs > 0) {
    lines.push(`Total Remaining: ${formatRemainingDuration(totalDeadlineMs - now)} (${formatRelativeTimestamp(normalized.totalDeadlineAt)})`);
  } else {
    lines.push('Total Remaining: Not started yet');
  }

  if (normalized.status === 'active') {
    if (Number.isFinite(questionDeadlineMs) && questionDeadlineMs > 0) {
      lines.push(`Question Remaining: ${formatRemainingDuration(questionDeadlineMs - now)} (${formatRelativeTimestamp(normalized.questionDeadlineAt)})`);
    } else {
      lines.push('Question Remaining: 8m 00s');
    }
  } else {
    lines.push('Question Remaining: Locked once you reach review.');
  }

  return lines.join('\n');
}

function buildIntroEmbed(userTag) {
  return new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle('SAVE DM Application')
    .setDescription(
      [
        'This application is completed entirely in DMs.',
        '',
        '> You will receive 30 written questions.',
        '> Reply in detail to each one.',
        '> Answer in your own words and do not rush it.',
        '> You will confirm before question 1 starts, and again before final submission.',
        '> You have 120 minutes total once question 1 begins.',
        '> Each question has an 8-minute timer that resets when the next question is sent.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'How It Works',
        value: 'I will send one question at a time. Reply to each DM message with your answer, and I will save it before moving to the next question.',
        inline: false,
      },
      {
        name: 'Important',
        value: 'If you stop halfway through, run the command again and I can continue from where you left off. You can also cancel from the button under each question.',
        inline: false,
      },
    )
    .setFooter({ text: `Started for ${userTag}` })
    .setTimestamp();
}

function buildQuestionEmbed(session) {
  const normalized = normalizeSessionTiming({
    ...session,
    questionDeadlines: [...(session.questionDeadlines || [])],
    questionRemainingMs: [...(session.questionRemainingMs || [])],
  });
  const questionNumber = normalized.currentQuestionIndex + 1;
  const question = QUESTIONS[normalized.currentQuestionIndex];

  return new EmbedBuilder()
    .setColor(0x48a8ff)
    .setTitle(`SAVE Application Question ${questionNumber}/30`)
    .setDescription(question)
    .addFields(
      {
        name: 'Answer Format',
        value: 'Reply to this DM with a written answer in your own words. Longer, specific answers are better than short generic ones.',
        inline: false,
      },
      {
        name: 'Progress',
        value: `${normalized.answers.length} completed | ${30 - normalized.answers.length} remaining`,
        inline: false,
      },
      {
        name: 'Time Limits',
        value: buildTimingField(normalized),
        inline: false,
      },
    )
    .setFooter({ text: 'Reply in this DM to answer, or use the buttons below to refresh, go back, or cancel.' })
    .setTimestamp();
}

function buildGoBackResendEmbed(session) {
  const normalized = normalizeSessionTiming({
    ...session,
    questionDeadlines: [...(session.questionDeadlines || [])],
    questionRemainingMs: [...(session.questionRemainingMs || [])],
  });
  const questionNumber = normalized.currentQuestionIndex + 1;
  const question = QUESTIONS[normalized.currentQuestionIndex];
  const nextQuestionNumber = (normalized.goBackState?.returnQuestionIndex ?? normalized.currentQuestionIndex + 1) + 1;

  return new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle(`Resend Question ${questionNumber}/30`)
    .setDescription(question)
    .addFields(
      {
        name: 'What To Do',
        value: [
          'Resend your full answer to this question in a brand-new DM message.',
          'Your previous answer is still saved internally, but I will not reuse it automatically.',
          `After you resend it, I will move you forward to question ${nextQuestionNumber}.`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Time Limits',
        value: buildTimingField(normalized),
        inline: false,
      },
    )
    .setFooter({ text: 'Resend the whole answer in a new message. The timer does not reset.' })
    .setTimestamp();
}

function buildApplicationProgressEmbed(session) {
  return session.goBackState ? buildGoBackResendEmbed(session) : buildQuestionEmbed(session);
}

function buildCompletionEmbed(session, user = null) {
  const submittedAt = session.completedAt || new Date().toISOString();
  const startedAt = session.applicationStartedAt || session.startedAt || null;
  const totalDurationMs = session.applicationStartedAt
    ? Math.max(0, new Date(submittedAt).getTime() - new Date(session.applicationStartedAt).getTime())
    : null;
  const displayName = user?.globalName || user?.displayName || user?.username || session.userTag || 'Applicant';
  const avatarUrl = typeof user?.displayAvatarURL === 'function'
    ? user.displayAvatarURL({ size: 256 })
    : null;

  const embed = new EmbedBuilder()
    .setColor(0xffffff)
    .setTitle('SAVE Application Submitted')
    .setDescription(
      [
        `Congratulations, **${displayName}**.`,
        '',
        'Your DM application has been completed and sent to SAVE command review.',
        '> SAVE command will reach back out if they need more information or once they are ready to follow up with you.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Submitted',
        value: formatTimestamp(submittedAt),
        inline: false,
      },
      {
        name: '\u200b',
        value: '────────',
        inline: false,
      },
      {
        name: 'SAVE-Info',
        value: `[Open Channel](${SAVE_INFO_CHANNEL_URL})`,
        inline: true,
      },
      {
        name: 'Role Requests',
        value: `[Open Channel](${ROLE_REQUEST_CHANNEL_URL})`,
        inline: true,
      },
      {
        name: 'Tickets',
        value: `[Open Tickets](${TICKETS_CHANNEL_URL})`,
        inline: true,
      },
      {
        name: 'Helpful While You Wait',
        value: [
          `> Review [SAVE-Info](${SAVE_INFO_CHANNEL_URL}).`,
          `> [Chat around in general](${GENERAL_CHAT_CHANNEL_URL}) and see how other members see **(SAVE)**.`,
          '> Use `/help` in-server if you need to review commands later.',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant DM Application' })
    .setImage(APPLICATION_COMPLETION_BANNER_URL)
    .setTimestamp(new Date(submittedAt));

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return embed;
}

function buildCancelledEmbed(session) {
  const cancelReason = String(session?.cancelReason || '').trim();
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('SAVE Application Cancelled')
    .setDescription(
      [
        'Your DM application was cancelled.',
        '',
        '> No submission was sent to SAVE command review.',
        '> If you want to restart later, run `/dmapplication` again.',
      ].join('\n'),
    )
    .addFields(
      ...(cancelReason
        ? [{
          name: 'Reason',
          value: cancelReason,
          inline: false,
        }]
        : []),
      {
        name: 'Application ID',
        value: session?.id || 'Unknown',
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant DM Application' })
    .setTimestamp();
}

function buildCancelledReviewEmbed(session) {
  const cancelReason = String(session?.cancelReason || '').trim();
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('SAVE DM Application Cancelled')
    .setDescription(
      [
        `Application flow cancelled by <@${session.userId}>.`,
        '',
        '> This application was not submitted to SAVE command review.',
        '> The current progress at the time of cancellation is recorded below.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Applicant',
        value: `<@${session.userId}>`,
        inline: true,
      },
      {
        name: 'Discord',
        value: session.userTag || 'Unknown',
        inline: true,
      },
      {
        name: 'Source Server',
        value: session.guildName || 'Unknown Server',
        inline: true,
      },
      {
        name: 'Started',
        value: formatTimestamp(session.startedAt),
        inline: true,
      },
      {
        name: 'Cancelled At',
        value: formatTimestamp(session.cancelledAt),
        inline: true,
      },
      {
        name: 'Questions Completed',
        value: `${session.answers?.length || 0}/${QUESTIONS.length}`,
        inline: true,
      },
      ...(cancelReason
        ? [{
          name: 'Reason',
          value: cancelReason,
          inline: false,
        }]
        : []),
      {
        name: 'Application ID',
        value: session.id || 'Unknown',
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant Application Cancellation Log' })
    .setTimestamp();
}

function buildStartedReviewEmbed(session) {
  return new EmbedBuilder()
    .setColor(0x5b8def)
    .setTitle('SAVE DM Application Started')
    .setDescription(
      [
        `Application flow started by <@${session.userId}>.`,
        '',
        '> The applicant has entered the DM application flow.',
        '> They have not submitted yet.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Applicant',
        value: `<@${session.userId}>`,
        inline: true,
      },
      {
        name: 'Discord',
        value: session.userTag || 'Unknown',
        inline: true,
      },
      {
        name: 'Source Server',
        value: session.guildName || 'Unknown Server',
        inline: true,
      },
      {
        name: 'Started',
        value: formatTimestamp(session.startedAt),
        inline: true,
      },
      {
        name: 'Application ID',
        value: session.id || 'Unknown',
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant Application Start Log' })
    .setTimestamp();
}

function buildStartPromptEmbed(session) {
  return new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle('SAVE DM Application')
    .setDescription(
      [
        'Your application is ready to begin.',
        '',
        '> Press `Ready To Begin` to receive question 1.',
        '> Press `Cancel Application` if you do not want to continue.',
        '> Once question 1 is sent, your 120-minute total timer begins.',
        '> Each question will also have an 8-minute timer.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Question Count',
        value: String(QUESTIONS.length),
        inline: true,
      },
      {
        name: 'Application ID',
        value: session.id,
        inline: true,
      },
    )
    .setFooter({ text: `Started for ${session.userTag}` })
    .setTimestamp();
}

function buildReviewPromptEmbed(session) {
  const normalized = normalizeSessionTiming({
    ...session,
    questionDeadlines: [...(session.questionDeadlines || [])],
    questionRemainingMs: [...(session.questionRemainingMs || [])],
  });
  return new EmbedBuilder()
    .setColor(0x5b8def)
    .setTitle('SAVE Application Ready To Submit')
    .setDescription(
      [
        'You finished all 30 questions.',
        '',
        '> Press `Confirm Submission` to send your application to SAVE command review.',
        '> Press `Cancel Application` if you do not want to submit it.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Progress',
        value: `${session.answers.length}/${QUESTIONS.length} questions completed`,
        inline: true,
      },
      {
        name: 'Time Remaining',
        value: buildTimingField(normalized),
        inline: false,
      },
      {
        name: 'Application ID',
        value: session.id,
        inline: true,
      },
    )
    .setFooter({ text: 'Submission confirmation required' })
    .setTimestamp();
}

function buildQuestionRow(session) {
  const normalized = normalizeSessionTiming({
    ...session,
    questionDeadlines: [...(session.questionDeadlines || [])],
    questionRemainingMs: [...(session.questionRemainingMs || [])],
  });

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_BACK_ID)
      .setLabel('Go Back')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canGoBackQuestion(normalized)),
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_REFRESH_ID)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_CANCEL_ID)
      .setLabel('Cancel Application')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildStartRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_BEGIN_ID)
      .setLabel('Ready To Begin')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_CANCEL_ID)
      .setLabel('Cancel Application')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildReviewRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_REFRESH_ID)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_CONFIRM_ID)
      .setLabel('Confirm Submission')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(DM_APPLICATION_CANCEL_ID)
      .setLabel('Cancel Application')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildGoBackReasonModal() {
  return new ModalBuilder()
    .setCustomId(DM_APPLICATION_BACK_MODAL_ID)
    .setTitle('Go Back Reason')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('go_back_reason')
          .setLabel('Why are you going back?')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(5)
          .setMaxLength(500)
          .setRequired(true)
          .setPlaceholder('Explain why you need to resend the previous answer.'),
      ),
    );
}

function buildTimedOutAnswer(questionIndex) {
  return {
    number: questionIndex + 1,
    question: QUESTIONS[questionIndex],
    answer: '[No response submitted before the question timer expired.]',
    answeredAt: new Date().toISOString(),
    timedOut: true,
  };
}

function advanceTimedOutQuestionsInSession(session) {
  let moved = false;

  while (!hasTotalSessionExpired(session) && hasCurrentQuestionExpired(session)) {
    const questionIndex = session.currentQuestionIndex;

    if (session.goBackState && session.goBackState.targetQuestionIndex === questionIndex) {
      const returnQuestionRemainingMs = Math.max(0, Number(session.goBackState.returnQuestionRemainingMs) || 0);
      session.answers = session.answers.slice(0, questionIndex);
      session.answers.push(session.goBackState.previousAnswer || buildTimedOutAnswer(questionIndex));
      session.questionRemainingMs[questionIndex] = 0;
      session.currentQuestionIndex = session.goBackState.returnQuestionIndex;
      session.questionDeadlineAt = null;
      session.goBackState = null;
      moved = true;

      if (session.currentQuestionIndex >= QUESTIONS.length) {
        moveSessionToReview(session);
        break;
      }

      session.questionRemainingMs[session.currentQuestionIndex] = returnQuestionRemainingMs;
      session.questionDeadlines[session.currentQuestionIndex] = null;
      syncCurrentQuestionDeadline(session);
      continue;
    }

    session.questionRemainingMs[questionIndex] = 0;
    session.questionDeadlines[questionIndex] = null;
    session.answers = session.answers.slice(0, questionIndex);
    session.answers.push(buildTimedOutAnswer(questionIndex));
    session.currentQuestionIndex += 1;
    session.questionDeadlineAt = null;
    moved = true;

    if (session.currentQuestionIndex >= QUESTIONS.length) {
      moveSessionToReview(session);
      break;
    }

    advanceQuestionTimer(session);
  }

  return moved;
}

function formatAnswerBlock(answerText) {
  const safeAnswer = String(answerText || '').trim() || 'No answer recorded.';
  const normalized = safeAnswer.replace(/\r/g, '');
  const clipped = normalized.length > 980
    ? `${normalized.slice(0, 940)}\n\n[Answer clipped for embed length]`
    : normalized;

  return `\`\`\`text\n${clipped}\n\`\`\``;
}

function buildReviewEmbeds(session, guildName) {
  const summary = new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle('SAVE DM Application Submission')
    .setDescription(
      [
        `Application packet received from <@${session.userId}>.`,
        '',
        '> Completed through the SAVE DM written application flow.',
        '> All written responses are attached below in cleaner review blocks.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Applicant',
        value: `<@${session.userId}>`,
        inline: true,
      },
      {
        name: 'Discord',
        value: session.userTag,
        inline: true,
      },
      {
        name: 'Source Server',
        value: guildName || 'Unknown Server',
        inline: true,
      },
      {
        name: 'Started',
        value: formatTimestamp(session.startedAt),
        inline: true,
      },
      {
        name: 'Completed',
        value: formatTimestamp(session.completedAt),
        inline: true,
      },
      {
        name: 'Question Count',
        value: String(session.answers.length),
        inline: true,
      },
      {
        name: 'Application ID',
        value: session.id,
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant Application Review Packet' })
    .setTimestamp();

  const answerEmbeds = [];

  for (let index = 0; index < session.answers.length; index += 5) {
    const chunk = session.answers.slice(index, index + 5);
    const embed = new EmbedBuilder()
      .setColor(0x2f6fed)
      .setTitle(`SAVE Application Answers ${index + 1}-${index + chunk.length}`)
      .setDescription(`Applicant: <@${session.userId}> | Packet: \`${session.id}\``)
      .setFooter({ text: `${session.userTag} | SAVE DM Application` })
      .setTimestamp();

    for (const answer of chunk) {
      embed.addFields({
        name: `Q${answer.number}. ${answer.question.slice(0, 180)}`,
        value: formatAnswerBlock(answer.answer),
        inline: false,
      });
    }

    answerEmbeds.push(embed);
  }

  return [summary, ...answerEmbeds];
}

function buildApplicationReviewPostTitle(session) {
  const applicantName = String(session?.userTag || 'Applicant')
    .split('#')[0]
    .replace(/[`@\r\n]/g, '')
    .trim() || 'Applicant';

  const applicationId = String(session?.id || 'Unknown').trim() || 'Unknown';
  const rawTitle = `${applicantName} - ${applicationId}`;
  return rawTitle.length > 100 ? rawTitle.slice(0, 100) : rawTitle;
}

function buildApplicationSubmittedAlertEmbed(session, postUrl) {
  return new EmbedBuilder()
    .setColor(0xf1c878)
    .setTitle('SAVE Application Submitted')
    .setDescription(
      [
        `A new SAVE DM application has been submitted by <@${session.userId}>.`,
        '',
        `> Application ID: \`${session.id}\``,
        `> Review Post: ${postUrl ? `[Open Forum Post](${postUrl})` : 'Forum post unavailable'}`,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Applicant',
        value: `<@${session.userId}>`,
        inline: true,
      },
      {
        name: 'Discord',
        value: session.userTag || 'Unknown',
        inline: true,
      },
      {
        name: 'Source Server',
        value: session.guildName || 'Unknown Server',
        inline: true,
      },
    )
    .setFooter({ text: 'SAVE Assistant Application Alert' })
    .setTimestamp();
}

function buildApplicationSubmissionAuditEmbed(session, postUrl) {
  const history = Array.isArray(session.goBackHistory) ? session.goBackHistory : [];
  const historyValue = history.length
    ? history.slice(-10).map((entry, index) => `${index + 1}. Q${entry.fromQuestion} -> Q${entry.toQuestion}: ${entry.reason}`).join('\n')
    : 'None recorded.';

  return new EmbedBuilder()
    .setColor(0x5b8def)
    .setTitle('SAVE Application Submission Audit')
    .setDescription(
      [
        `Submission audit for <@${session.userId}>.`,
        '',
        `> Application ID: \`${session.id}\``,
        `> Review Post: ${postUrl ? `[Open Forum Post](${postUrl})` : 'Forum post unavailable'}`,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Applicant',
        value: `${session.userTag || 'Unknown'} (${session.userId})`,
        inline: false,
      },
      {
        name: 'Go Back Reasons',
        value: historyValue.slice(0, 1024),
        inline: false,
      },
    )
    .setFooter({ text: 'SAVE Assistant Application Audit Log' })
    .setTimestamp();
}

async function postApplicationSubmissionAlert(client, session, postUrl) {
  const channel = await client.channels.fetch(APPLICATION_ALERT_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  await channel.send({
    content: `<@&${APPLICATION_ALERT_ROLE_ID}>`,
    allowedMentions: {
      roles: [APPLICATION_ALERT_ROLE_ID],
    },
    embeds: [buildApplicationSubmittedAlertEmbed(session, postUrl)],
  });
}

async function postApplicationSubmissionAudit(client, session, postUrl) {
  const channel = await client.channels.fetch(APPLICATION_LOG_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  await channel.send({
    embeds: [buildApplicationSubmissionAuditEmbed(session, postUrl)],
  });
}

async function postApplicationReview(client, session) {
  const forum = await client.channels.fetch(APPLICATION_REVIEW_FORUM_ID).catch(() => null);

  if (!forum || forum.type !== ChannelType.GuildForum) {
    const fallbackChannel = await client.channels.fetch(APPLICATION_LOG_CHANNEL_ID).catch(() => null);

    if (!fallbackChannel || !fallbackChannel.isTextBased()) {
      throw new Error(`Could not access application review forum ${APPLICATION_REVIEW_FORUM_ID} or fallback channel ${APPLICATION_LOG_CHANNEL_ID}.`);
    }

    const fallbackEmbeds = buildReviewEmbeds(session, session.guildName);
    for (let index = 0; index < fallbackEmbeds.length; index += 10) {
      await fallbackChannel.send({
        embeds: fallbackEmbeds.slice(index, index + 10),
      });
    }
    await postApplicationSubmissionAlert(client, session, null);
    await postApplicationSubmissionAudit(client, session, null);
    return;
  }

  const embeds = buildReviewEmbeds(session, session.guildName);
  const thread = await forum.threads.create({
    name: buildApplicationReviewPostTitle(session),
    message: {
      embeds,
    },
    reason: `SAVE application submitted by ${session.userTag || session.userId || 'Unknown applicant'}`,
  });

  await postApplicationSubmissionAlert(client, session, thread?.url || null);
  await postApplicationSubmissionAudit(client, session, thread?.url || null);
}

async function postCancelledApplicationReview(client, session) {
  const channel = await client.channels.fetch(APPLICATION_LOG_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Could not access application review channel ${APPLICATION_LOG_CHANNEL_ID}.`);
  }

  await channel.send({
    embeds: [buildCancelledReviewEmbed(session)],
  });
}

async function postStartedApplicationReview(client, session) {
  const channel = await client.channels.fetch(APPLICATION_LOG_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Could not access application review channel ${APPLICATION_LOG_CHANNEL_ID}.`);
  }

  await channel.send({
    embeds: [buildStartedReviewEmbed(session)],
  });
}

async function expireApplicationSession(client, user, session, reason) {
  const cancelledSession = {
    ...session,
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelReason: reason,
    questionDeadlineAt: null,
  };

  try {
    await postCancelledApplicationReview(client, cancelledSession);
  } catch (error) {
    console.error('Failed to log expired DM application:', error);
  }

  clearSession(user.id || session.userId);

  try {
    await user.send({
      embeds: [buildCancelledEmbed(cancelledSession)],
      components: [],
    });
  } catch (error) {
    console.error('Failed to DM expired application notice:', error);
  }

  return cancelledSession;
}

async function processTimedOutQuestions(client, user, session, { notify = true } = {}) {
  normalizeSessionTiming(session);

  if (hasTotalSessionExpired(session)) {
      await expireApplicationSession(client, user, session, 'The 120-minute total application limit expired.');
    return { expired: true, moved: false, session: null };
  }

  const moved = advanceTimedOutQuestionsInSession(session);
  if (!moved) {
    return { expired: false, moved: false, session };
  }

  if (hasTotalSessionExpired(session)) {
      await expireApplicationSession(client, user, session, 'The 120-minute total application limit expired.');
    return { expired: true, moved: true, session: null };
  }

  setSession(user.id || session.userId, session);

  if (notify) {
    try {
      if (session.status === 'review') {
        await user.send('Time ran out on your previous question, so I moved you to final submission.');
        await sendReviewPrompt(user, session);
      } else {
        await user.send('Time ran out on your previous question, so I moved you to the next one.');
        await sendCurrentQuestion(user, session);
      }
    } catch (error) {
      console.error('Failed to notify about DM application timeout advance:', error);
    }
  }

  return { expired: false, moved: true, session };
}

async function disableDmPromptById(user, messageId) {
  if (!messageId) {
    return;
  }

  try {
    const dmChannel = user.dmChannel || await user.createDM();
    const promptMessage = await dmChannel.messages.fetch(messageId).catch(() => null);
    if (!promptMessage) {
      return;
    }

    await promptMessage.edit({
      components: [],
    }).catch(() => null);
  } catch {
    // Ignore prompt cleanup failures.
  }
}

async function sendCurrentQuestion(user, session) {
  const previousPromptMessageId = session.activePromptMessageId || null;
  const sentMessage = await user.send({
    embeds: [buildApplicationProgressEmbed(session)],
    components: [buildQuestionRow(session)],
  });

  session.activePromptMessageId = sentMessage.id;
  session.activePromptKind = 'question';
  setSession(user.id || session.userId, session);
  await disableDmPromptById(user, previousPromptMessageId);
}

async function sendReviewPrompt(user, session) {
  session.questionDeadlineAt = null;
  const previousPromptMessageId = session.activePromptMessageId || null;
  const sentMessage = await user.send({
    embeds: [buildReviewPromptEmbed(session)],
    components: [buildReviewRow()],
  });

  session.activePromptMessageId = sentMessage.id;
  session.activePromptKind = 'review';
  setSession(user.id || session.userId, session);
  await disableDmPromptById(user, previousPromptMessageId);
}

async function startOrResumeApplication({ interaction }) {
  const existingSession = getSession(interaction.user.id);

  if (existingSession && existingSession.status === 'active') {
    normalizeSessionTiming(existingSession);
    const timeoutState = await processTimedOutQuestions(interaction.client, interaction.user, existingSession, { notify: false });
    if (timeoutState.expired) {
      await interaction.reply({
        content: 'Your previous SAVE DM application expired. I sent the timeout notice in DMs. Run `/dmapplication` to start over.',
        ephemeral: true,
      });
      return;
    }

    const resumedSession = timeoutState.session || existingSession;
    setSession(interaction.user.id, resumedSession);
    try {
      if (resumedSession.status === 'review') {
        await sendReviewPrompt(interaction.user, resumedSession);
      } else {
        await sendCurrentQuestion(interaction.user, resumedSession);
      }

      await interaction.reply({
        content: resumedSession.status === 'review'
          ? 'Your SAVE DM application advanced while you were away. I resent the final submission prompt in DMs.'
          : 'Your SAVE DM application is already active. I resent your current question in DMs so you can continue.',
        ephemeral: true,
      });
      return;
    } catch (error) {
      console.error('Failed to resume DM application:', error);
      await interaction.reply({
        content: 'I could not DM you the active application. Check that your DMs are open, then try again.',
        ephemeral: true,
      });
      return;
    }
  }

  if (existingSession && existingSession.status === 'pending_start') {
    try {
      await interaction.user.send({
        embeds: [buildStartPromptEmbed(existingSession)],
        components: [buildStartRow()],
      });

      await interaction.reply({
        content: 'Your SAVE DM application is waiting on your start confirmation. I resent the start prompt in DMs.',
        ephemeral: true,
      });
      return;
    } catch (error) {
      console.error('Failed to resume DM start prompt:', error);
      await interaction.reply({
        content: 'I could not DM you the start prompt. Check that your DMs are open, then try again.',
        ephemeral: true,
      });
      return;
    }
  }

  if (existingSession && existingSession.status === 'review') {
    normalizeSessionTiming(existingSession);
    const timeoutReason = getSessionTimeoutReason(existingSession);
    if (timeoutReason) {
      await expireApplicationSession(interaction.client, interaction.user, existingSession, timeoutReason);
      await interaction.reply({
        content: 'Your previous SAVE DM application timed out before submission. I sent the timeout notice in DMs. Run `/dmapplication` to start over.',
        ephemeral: true,
      });
      return;
    }

    setSession(interaction.user.id, existingSession);
    try {
      await sendReviewPrompt(interaction.user, existingSession);

      await interaction.reply({
        content: 'Your SAVE DM application is waiting for final confirmation. I resent the submission prompt in DMs.',
        ephemeral: true,
      });
      return;
    } catch (error) {
      console.error('Failed to resume DM review prompt:', error);
      await interaction.reply({
        content: 'I could not DM you the submission confirmation prompt. Check that your DMs are open, then try again.',
        ephemeral: true,
      });
      return;
    }
  }

  const session = {
    id: `SAVE-DM-${Date.now()}`,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    guildId: interaction.guildId,
    guildName: interaction.guild?.name || 'Unknown Server',
    startedAt: new Date().toISOString(),
    completedAt: null,
    cancelledAt: null,
    currentQuestionIndex: 0,
    status: 'pending_start',
    answers: [],
    questionDeadlines: [],
    questionRemainingMs: [],
    applicationStartedAt: null,
    totalDeadlineAt: null,
    questionDeadlineAt: null,
    cancelReason: null,
  };

  setSession(interaction.user.id, session);

  try {
    await postStartedApplicationReview(interaction.client, session);

    await interaction.user.send({
      embeds: [buildIntroEmbed(interaction.user.tag)],
    });
    await interaction.user.send({
      embeds: [buildStartPromptEmbed(session)],
      components: [buildStartRow()],
    });

    await interaction.reply({
      content: 'I started your SAVE DM application and sent the start prompt to your DMs.',
      ephemeral: true,
    });
  } catch (error) {
    console.error('Failed to start DM application:', error);
    clearSession(interaction.user.id);
    await interaction.reply({
      content: 'I could not DM you the application. Check that your direct messages are open, then try again.',
      ephemeral: true,
    });
  }
}

async function handleApplicationDmMessage(client, message) {
  if (!message.channel?.isDMBased() || message.author.bot) {
    return;
  }

  const session = getSession(message.author.id);

  if (!session) {
    return;
  }

  normalizeSessionTiming(session);

  if (hasTotalSessionExpired(session)) {
    await expireApplicationSession(client, message.author, session, 'The 120-minute total application limit expired.');
    return;
  }

  if (session.status === 'active') {
    const timeoutState = await processTimedOutQuestions(client, message.author, session, { notify: false });
    if (timeoutState.expired) {
      return;
    }

    if (timeoutState.moved) {
      const updatedSession = timeoutState.session;
      if (updatedSession.status === 'review') {
        await message.reply('Time ran out on your previous question, so I moved you to final submission.');
        await sendReviewPrompt(message.author, updatedSession);
      } else {
        await message.reply('Time ran out on your previous question, so I moved you to the next one.');
        await sendCurrentQuestion(message.author, updatedSession);
      }
      return;
    }
  }

  const timeoutReason = getSessionTimeoutReason(session);
  if (timeoutReason) {
    await expireApplicationSession(client, message.author, session, timeoutReason);
    return;
  }

  if (session.status === 'review') {
    await message.reply('You already finished the questions. Use the confirm or cancel buttons in the most recent DM from me.');
    return;
  }

  if (session.status !== 'active') {
    return;
  }

  const answerText = String(message.content || '').trim();

  if (!answerText) {
    await message.reply('I need a written answer to save this question.');
    return;
  }

  const questionIndex = session.currentQuestionIndex;
  const question = QUESTIONS[questionIndex];

  const answerEntry = {
    number: questionIndex + 1,
    question,
    answer: answerText,
    answeredAt: new Date().toISOString(),
  };

  if (session.goBackState && session.goBackState.targetQuestionIndex === questionIndex) {
    const returnQuestionIndex = session.goBackState.returnQuestionIndex;
    const returnQuestionRemainingMs = Math.max(0, Number(session.goBackState.returnQuestionRemainingMs) || 0);
    session.answers = session.answers.slice(0, questionIndex);
    session.answers.push(answerEntry);
    freezeCurrentQuestionRemaining(session);
    session.currentQuestionIndex = returnQuestionIndex;
    session.questionRemainingMs[returnQuestionIndex] = returnQuestionRemainingMs;
    session.questionDeadlines[returnQuestionIndex] = null;
    session.questionDeadlineAt = null;
    session.goBackState = null;

    if (session.currentQuestionIndex >= QUESTIONS.length) {
      moveSessionToReview(session);
      setSession(message.author.id, session);
      await message.react('✅').catch(() => null);
      await message.author.send('Your updated answer was saved. I moved you back to final submission.').catch(() => null);
      await sendReviewPrompt(message.author, session);
      return;
    }

    normalizeSessionTiming(session);

    if (hasTotalSessionExpired(session)) {
      await expireApplicationSession(client, message.author, session, 'The 120-minute total application limit expired.');
      return;
    }

    const movedPastExpiredQuestion = advanceTimedOutQuestionsInSession(session);
    setSession(message.author.id, session);
    await message.react('✅').catch(() => null);

    if (session.status === 'review') {
      await message.author.send('Your updated answer was saved. Time ran out on the next question, so I moved you to final submission.').catch(() => null);
      await sendReviewPrompt(message.author, session);
      return;
    }

    if (movedPastExpiredQuestion) {
      await message.author.send('Your updated answer was saved. Time ran out on the next question, so I moved you further ahead.').catch(() => null);
    } else {
      await message.author.send(`Your updated answer was saved. I moved you back to question ${session.currentQuestionIndex + 1}.`).catch(() => null);
    }

    await sendCurrentQuestion(message.author, session);
    return;
  }

  freezeCurrentQuestionRemaining(session);
  session.answers.push(answerEntry);
  session.currentQuestionIndex += 1;
  session.questionDeadlineAt = null;

  if (session.currentQuestionIndex >= QUESTIONS.length) {
    moveSessionToReview(session);
    setSession(message.author.id, session);

    try {
      await message.react('✅').catch(() => null);
      await sendReviewPrompt(message.author, session);
    } catch (error) {
      console.error('Failed to send DM application review prompt:', error);
      await message.channel.send('I saved your answers, but I hit an error while sending the confirmation prompt. Run `/dmapplication` again and I will resume it.');
    }
    return;
  }

  advanceQuestionTimer(session);
  if (hasTotalSessionExpired(session)) {
    await expireApplicationSession(client, message.author, session, 'The 120-minute total application limit expired.');
    return;
  }

  const movedPastExpiredQuestion = advanceTimedOutQuestionsInSession(session);
  if (movedPastExpiredQuestion && session.status === 'review') {
    setSession(message.author.id, session);
    await message.react('✅').catch(() => null);
    await sendReviewPrompt(message.author, session);
    return;
  }

  setSession(message.author.id, session);

  await message.react('✅').catch(() => null);
  await sendCurrentQuestion(message.author, session);
}

async function handleApplicationDmMessageV2(client, message) {
  if (!message.channel?.isDMBased() || message.author.bot) {
    return;
  }

  const session = getSession(message.author.id);
  if (!session) {
    return;
  }

  normalizeSessionTiming(session);

  if (hasTotalSessionExpired(session)) {
    await expireApplicationSession(client, message.author, session, 'The 120-minute total application limit expired.');
    return;
  }

  if (session.status === 'active') {
    const timeoutState = await processTimedOutQuestions(client, message.author, session, { notify: false });
    if (timeoutState.expired) {
      return;
    }

    if (timeoutState.moved) {
      const updatedSession = timeoutState.session;
      if (updatedSession.status === 'review') {
        await message.reply('Time ran out on your previous question, so I moved you to final submission.');
        await sendReviewPrompt(message.author, updatedSession);
      } else {
        await message.reply('Time ran out on your previous question, so I moved you to the next one.');
        await sendCurrentQuestion(message.author, updatedSession);
      }
      return;
    }
  }

  const timeoutReason = getSessionTimeoutReason(session);
  if (timeoutReason) {
    await expireApplicationSession(client, message.author, session, timeoutReason);
    return;
  }

  if (session.status === 'review') {
    await message.reply('You already finished the questions. Use the confirm or cancel buttons in the most recent DM from me.');
    return;
  }

  if (session.status !== 'active') {
    return;
  }

  const answerText = String(message.content || '').trim();
  if (!answerText) {
    await message.reply('I need a written answer to save this question.');
    return;
  }

  const questionIndex = session.currentQuestionIndex;
  const question = QUESTIONS[questionIndex];
  const answerEntry = {
    number: questionIndex + 1,
    question,
    answer: answerText,
    answeredAt: new Date().toISOString(),
  };

  if (session.goBackState && session.goBackState.targetQuestionIndex === questionIndex) {
    const returnQuestionIndex = session.goBackState.returnQuestionIndex;
    const returnQuestionRemainingMs = Math.max(0, Number(session.goBackState.returnQuestionRemainingMs) || 0);
    session.answers = session.answers.slice(0, questionIndex);
    session.answers.push(answerEntry);
    session.currentQuestionIndex = returnQuestionIndex;
    session.questionDeadlines[returnQuestionIndex] = new Date(Date.now() + returnQuestionRemainingMs).toISOString();
    session.goBackState = null;

    if (session.currentQuestionIndex >= QUESTIONS.length) {
      moveSessionToReview(session);
      setSession(message.author.id, session);
      await message.react('✅').catch(() => null);
      await sendReviewPrompt(message.author, session);
      return;
    }

    normalizeSessionTiming(session);

    if (hasTotalSessionExpired(session)) {
      await expireApplicationSession(client, message.author, session, 'The 120-minute total application limit expired.');
      return;
    }

    advanceTimedOutQuestionsInSession(session);
    setSession(message.author.id, session);
    await message.react('✅').catch(() => null);

    if (session.status === 'review') {
      await sendReviewPrompt(message.author, session);
      return;
    }

    await sendCurrentQuestion(message.author, session);
    return;
  }

  session.answers.push(answerEntry);
  session.currentQuestionIndex += 1;

  if (session.currentQuestionIndex >= QUESTIONS.length) {
    moveSessionToReview(session);
    setSession(message.author.id, session);

    try {
      await message.react('✅').catch(() => null);
      await sendReviewPrompt(message.author, session);
    } catch (error) {
      console.error('Failed to send DM application review prompt:', error);
      await message.channel.send('I saved your answers, but I hit an error while sending the confirmation prompt. Run `/dmapplication` again and I will resume it.');
    }
    return;
  }

  advanceQuestionTimer(session);
  if (hasTotalSessionExpired(session)) {
    await expireApplicationSession(client, message.author, session, 'The 120-minute total application limit expired.');
    return;
  }

  const movedPastExpiredQuestion = advanceTimedOutQuestionsInSession(session);
  if (movedPastExpiredQuestion && session.status === 'review') {
    setSession(message.author.id, session);
    await message.react('✅').catch(() => null);
    await sendReviewPrompt(message.author, session);
    return;
  }

  setSession(message.author.id, session);
  await message.react('✅').catch(() => null);
  await sendCurrentQuestion(message.author, session);
}

async function processApplicationTimeouts(client) {
  const sessions = loadSessions();

  for (const [userId, session] of Object.entries(sessions)) {
    if (!session || !['active', 'review'].includes(session.status)) {
      continue;
    }

    const user = await client.users.fetch(userId).catch(() => null);
    const fallbackUser = user || {
      id: userId,
      send: async () => {},
    };

    normalizeSessionTiming(session);

    if (hasTotalSessionExpired(session)) {
      await expireApplicationSession(client, fallbackUser, session, 'The 120-minute total application limit expired.');
      continue;
    }

    if (session.status === 'active') {
      await processTimedOutQuestions(client, fallbackUser, session);
    }
  }
}

module.exports = {
  buildApplicationProgressEmbed,
  buildGoBackReasonModal,
  buildQuestionRow,
  buildCancelledEmbed,
  buildQuestionEmbed,
  buildStartPromptEmbed,
  buildCompletionEmbed,
  buildCancelledReviewEmbed,
  buildStartedReviewEmbed,
  buildReviewPromptEmbed,
  buildReviewRow,
  DM_APPLICATION_BEGIN_ID,
  DM_APPLICATION_BACK_ID,
  DM_APPLICATION_BACK_MODAL_ID,
  DM_APPLICATION_CANCEL_ID,
  DM_APPLICATION_CONFIRM_ID,
  DM_APPLICATION_REFRESH_ID,
  canGoBackQuestion,
  expireApplicationSession,
  clearSession,
  getSessionTimeoutReason,
  getSession,
  markSessionStarted,
  normalizeSessionTiming,
  postApplicationReview,
  postCancelledApplicationReview,
  postStartedApplicationReview,
  processApplicationTimeouts,
  processTimedOutQuestions,
  sendCurrentQuestion,
  setSession,
  startOrResumeApplication,
  handleApplicationDmMessage: handleApplicationDmMessageV2,
  APPLICATION_LOG_CHANNEL_ID,
};
