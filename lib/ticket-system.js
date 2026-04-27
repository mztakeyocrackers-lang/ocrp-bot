const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { sendUserNotification } = require('./notification-utils');

const DATA_FILE = path.join(__dirname, '..', 'data', 'ticket-systems.json');
const THREAD_STATE_FILE = path.join(__dirname, '..', 'data', 'ticket-thread-state.json');
const DEBUG_LOG_FILE = path.join(__dirname, '..', 'data', 'ticket-close-debug.log');
const MAX_TRANSCRIPT_MESSAGES = 5000;
const TRANSCRIPT_BASE_URL = (process.env.TRANSCRIPT_BASE_URL || 'https://save-stuff.vercel.app').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID || '1467046746851901501';
const TICKET_OPEN_REQUIRED_ROLE_ID = process.env.TICKET_OPEN_REQUIRED_ROLE_ID || process.env.ROBLOX_VERIFIED_ROLE_ID || '1465136660969820304';
const GENERAL_TICKET_SUPPORT_ROLE_ID = process.env.GENERAL_TICKET_SUPPORT_ROLE_ID || '1465136661045448818';
const REPORT_APPEAL_SUPPORT_ROLE_ID = process.env.REPORT_APPEAL_SUPPORT_ROLE_ID || '1465136661187924105';
const IA_TICKET_SUPPORT_ROLE_ID = process.env.IA_TICKET_SUPPORT_ROLE_ID || '1465136661187924105';
const IA_TICKET_LOG_CHANNEL_ID = process.env.IA_TICKET_LOG_CHANNEL_ID || '1467046746851901501';
const IA_TICKET_PARENT_CATEGORY_ID = process.env.IA_TICKET_PARENT_CATEGORY_ID || '1498192400517042397';
const TICKET_THREAD_DELETE_DELAY_MS = 60 * 60 * 1000;
const STAFF_REPLY_PING_COOLDOWN_MS = 15000;

const TICKET_OPEN_GENERAL = 'ticket_open_general';
const TICKET_OPEN_REPORT = 'ticket_open_report';
const TICKET_OPEN_APPEAL = 'ticket_open_appeal';
const TICKET_OPEN_IA = 'ticket_open_ia';
const TICKET_OPEN_CUSTOM_PREFIX = 'ticket_open_custom';
const TICKET_OPEN_PANEL_PREFIX = 'ticket_open_panel';
const TICKET_OPEN_SELECT = 'ticket_open_select';
const TICKET_CLOSE = 'ticket_close';
const TICKET_CREATE_MODAL_GENERAL = 'ticket_create_modal_general';
const TICKET_CREATE_MODAL_REPORT = 'ticket_create_modal_report';
const TICKET_CREATE_MODAL_APPEAL = 'ticket_create_modal_appeal';
const TICKET_CREATE_MODAL_IA = 'ticket_create_modal_ia';
const TICKET_CREATE_MODAL_CUSTOM_PREFIX = 'ticket_create_modal_custom';
const TICKET_CLOSE_MODAL = 'ticket_close_modal';
const TICKET_REASON_INPUT = 'ticket_reason_input';
const TICKET_REPORT_AUTHOR_RBX_INPUT = 'ticket_report_author_rbx_input';
const TICKET_REPORT_TARGET_RBX_INPUT = 'ticket_report_target_rbx_input';
const TICKET_REPORT_INCIDENT_INPUT = 'ticket_report_incident_input';
const TICKET_REPORT_EVIDENCE_INPUT = 'ticket_report_evidence_input';
const TICKET_CLOSE_REASON_INPUT = 'ticket_close_reason_input';

const TICKET_SETUP_POST_SUPPORT = 'ticket_setup_post_support';
const TICKET_SETUP_POST_IA = 'ticket_setup_post_ia';
const TICKET_SETUP_CREATE_CUSTOM = 'ticket_setup_create_custom';
const TICKET_SETUP_CUSTOM_MODAL = 'ticket_setup_custom_modal';
const REASON_MARKER = '\u25AB\uFE0F';
const TICKET_PENDING_SYSTEM_ID = 'pending';
const IA_TICKET_SYSTEM_ID = 'ia-statements';

const BUILT_IN_SYSTEMS = {
  general: {
    systemId: 'general',
    type: 'general',
    label: 'General Support',
    color: 0x5865f2,
  },
  report: {
    systemId: 'report',
    type: 'report',
    label: '(SAVE) Report',
    color: 0xed4245,
  },
  appeal: {
    systemId: 'appeal',
    type: 'appeal',
    label: 'Disciplinary Action Appeal',
    color: 0xf1c878,
  },
  ia: {
    systemId: 'ia',
    type: 'ia',
    label: 'IA Statement',
    color: 0xed4245,
  },
};

function getIaStatementSystem() {
  return {
    id: IA_TICKET_SYSTEM_ID,
    systemId: IA_TICKET_SYSTEM_ID,
    type: 'custom',
    name: 'IA Statement',
    label: 'IA Statement',
    color: 0xed4245,
    supportRoleIds: [IA_TICKET_SUPPORT_ROLE_ID].filter(Boolean),
    maxOpenTicketsPerUser: 1,
    logChannelId: IA_TICKET_LOG_CHANNEL_ID || DEFAULT_TICKET_LOG_CHANNEL_ID,
    omitUsernameInThreadName: true,
    threadNamePrefix: 'ia-statement',
    suppressSupportPing: true,
  };
}

const recentReplyPings = new Map();

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

function loadCustomSystems() {
  ensureDataDir();

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomSystems(systems) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(systems, null, 2), 'utf8');
}

function loadThreadState() {
  ensureDataDir();

  try {
    const raw = fs.readFileSync(THREAD_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

function saveThreadState(state) {
  ensureDataDir();
  fs.writeFileSync(THREAD_STATE_FILE, JSON.stringify({
    entries: Array.isArray(state?.entries) ? state.entries : [],
  }, null, 2), 'utf8');
}

function upsertThreadEntry(entry) {
  const state = loadThreadState();
  state.entries = [
    ...state.entries.filter((item) => String(item.threadId) !== String(entry.threadId)),
    entry,
  ];
  saveThreadState(state);
}

function removeThreadEntry(threadId) {
  const state = loadThreadState();
  state.entries = state.entries.filter((item) => String(item.threadId) !== String(threadId));
  saveThreadState(state);
}

function getThreadEntry(threadId) {
  return loadThreadState().entries.find((item) => String(item.threadId) === String(threadId)) || null;
}

async function pruneMissingThreadEntries(client, predicate) {
  if (!client || typeof predicate !== 'function') {
    return 0;
  }

  const state = loadThreadState();
  const matchingEntries = state.entries.filter((item) => predicate(item));
  if (!matchingEntries.length) {
    return 0;
  }

  const missingThreadIds = new Set();

  for (const entry of matchingEntries) {
    const cachedChannel = client.channels?.cache?.get(entry.threadId) || null;
    const channel = cachedChannel || await client.channels.fetch(entry.threadId).catch(() => null);
    if (!channel || typeof channel.isThread !== 'function' || !channel.isThread()) {
      missingThreadIds.add(String(entry.threadId));
    }
  }

  if (!missingThreadIds.size) {
    return 0;
  }

  state.entries = state.entries.filter((item) => !missingThreadIds.has(String(item.threadId)));
  saveThreadState(state);
  return missingThreadIds.size;
}

function countOpenThreadEntries({ parentChannelId, systemId, ownerId }) {
  const state = loadThreadState();
  return state.entries.filter((item) =>
    String(item.parentChannelId) === String(parentChannelId)
    && String(item.systemId) === String(systemId)
    && String(item.ownerId) === String(ownerId)
    && item.status !== 'closed'
  ).length;
}

function countPendingThreadEntries({ parentChannelId, ownerId }) {
  const state = loadThreadState();
  return state.entries.filter((item) =>
    String(item.parentChannelId) === String(parentChannelId)
    && String(item.ownerId) === String(ownerId)
    && String(item.status) === 'pending'
  ).length;
}

async function countOpenManagedChannels({ guild, systemId, ownerId, categoryId = null }) {
  if (!guild) {
    return 0;
  }

  const fetchedChannels = await guild.channels.fetch().catch(() => null);
  const channels = fetchedChannels ? Array.from(fetchedChannels.values()) : Array.from(guild.channels?.cache?.values?.() || []);

  return channels.filter((channel) => {
    if (!channel || channel.type !== ChannelType.GuildText) {
      return false;
    }

    if (categoryId && String(channel.parentId) !== String(categoryId)) {
      return false;
    }

    const parsed = parseTicketTopic(channel.topic);
    if (!parsed) {
      return false;
    }

    return String(parsed.systemId) === String(systemId) && String(parsed.ownerId) === String(ownerId);
  }).length;
}

function appendTicketDebug(message, details = null) {
  ensureDataDir();
  const lines = [
    `[${new Date().toISOString()}] ${message}`,
  ];

  if (details) {
    try {
      lines.push(JSON.stringify(details));
    } catch {
      lines.push(String(details));
    }
  }

  fs.appendFileSync(DEBUG_LOG_FILE, `${lines.join('\n')}\n`, 'utf8');
}

function getCustomSystemById(systemId) {
  if (String(systemId) === IA_TICKET_SYSTEM_ID) {
    return getIaStatementSystem();
  }

  return loadCustomSystems().find((system) => system.id === systemId) || null;
}

function buildTicketTopic(systemId, userId) {
  return `ticket:${systemId}:${userId}:${randomUUID().slice(0, 8)}`;
}

function parseTicketTopic(topic) {
  const match = /^ticket:([^:]+):(\d+)(?::([a-z0-9-]+))?$/i.exec(String(topic ?? ''));
  if (!match) {
    return null;
  }

  return {
    systemId: match[1],
    ownerId: match[2],
    ticketId: match[3] || null,
  };
}

function getManagedTicketContext(channel) {
  if (!channel) {
    return null;
  }

  if (typeof channel.isThread === 'function' && channel.isThread()) {
    const threadEntry = getThreadEntry(channel.id);
    if (!threadEntry) {
      return null;
    }

    return {
      systemId: threadEntry.systemId,
      ownerId: threadEntry.ownerId,
      ticketId: threadEntry.ticketId || null,
      threadId: threadEntry.threadId,
      parentChannelId: threadEntry.parentChannelId,
      mode: 'thread',
    };
  }

  const parsed = parseTicketTopic(channel.topic);
  return parsed ? { ...parsed, mode: 'channel' } : null;
}

function sanitizeChannelId(value) {
  const trimmed = String(value || '').trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Channel IDs must contain only numbers.');
  }

  return trimmed;
}

function parseRoleIds(value) {
  const ids = String(value || '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!ids.length) {
    throw new Error('At least one support role ID is required.');
  }

  const invalid = ids.find((id) => !/^\d+$/.test(id));
  if (invalid) {
    throw new Error(`Invalid role ID: ${invalid}`);
  }

  return Array.from(new Set(ids));
}

function parseMaxTickets(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
    throw new Error('Max tickets must be a number between 1 and 20.');
  }

  return parsed;
}

function sanitizeSystemName(value) {
  const name = String(value || '').trim();
  if (!name) {
    throw new Error('System name is required.');
  }

  return name.slice(0, 80);
}

function buildCustomSystemId(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'custom-ticket';

  return `custom-${slug}-${randomUUID().slice(0, 6)}`;
}

function buildTicketTypeName(system) {
  return system?.label || 'Ticket';
}

function getTicketTypeColor(system) {
  return Number(system?.color) || 0x5865f2;
}

function sanitizeNameSegment(value, maxLength = 18, fallback = 'ticket') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength) || fallback;
}

function buildManagedChannelTicketName(system, suffix = '') {
  const prefix = sanitizeNameSegment(system?.channelNamePrefix || system?.label || 'ticket', 32, 'ticket');
  const safeSuffix = sanitizeNameSegment(suffix || randomUUID().slice(0, 8), 12, 'ticket');
  return [prefix, safeSuffix].filter(Boolean).join('-').slice(0, 90);
}

function buildTicketOpenOptions(panelType = 'default') {
  const customSystems = loadCustomSystems();
  const builtIns = panelType === 'appeal'
    ? [BUILT_IN_SYSTEMS.appeal]
    : [BUILT_IN_SYSTEMS.general, BUILT_IN_SYSTEMS.report, BUILT_IN_SYSTEMS.appeal];

  const customOptions = customSystems.map((system) => ({
    label: buildTicketTypeName(system).slice(0, 100),
    description: truncate(`Open a ${buildTicketTypeName(system)} thread ticket.`, 100),
    value: `${TICKET_OPEN_CUSTOM_PREFIX}:${system.id}`,
  }));

  return [
    ...builtIns.map((system) => ({
      label: (
        system.systemId === 'report'
          ? '(SAVE) REPORT TICKET'
          : system.systemId === 'appeal'
            ? 'DISCIPLINARY APPEAL TICKET'
            : 'GENERAL SUPPORT TICKET'
      ).slice(0, 100),
      description: truncate(
        system.systemId === 'report'
          ? `${REASON_MARKER} Reports, evidence, and internal issues.`
          : system.systemId === 'appeal'
            ? `${REASON_MARKER} Appeal a disciplinary action through a private ticket thread.`
            : `${REASON_MARKER} Questions, support requests, and internal help.`,
        100,
      ),
      value: system.systemId === 'report'
        ? TICKET_OPEN_REPORT
        : system.systemId === 'appeal'
          ? TICKET_OPEN_APPEAL
          : TICKET_OPEN_GENERAL,
    })),
    ...customOptions,
  ].slice(0, 25);
}

function resolveIntakeSupportRoleIds(panelType = 'default', system = null) {
  if (system && Array.isArray(system.supportRoleIds) && system.supportRoleIds.length) {
    return Array.from(new Set(system.supportRoleIds.filter(Boolean)));
  }

  if (panelType === 'appeal') {
    return [REPORT_APPEAL_SUPPORT_ROLE_ID].filter(Boolean);
  }

  const customRoleIds = loadCustomSystems()
    .flatMap((customSystem) => Array.isArray(customSystem.supportRoleIds) ? customSystem.supportRoleIds : [])
    .filter(Boolean);

  return Array.from(new Set([
    GENERAL_TICKET_SUPPORT_ROLE_ID,
    REPORT_APPEAL_SUPPORT_ROLE_ID,
    ...customRoleIds,
  ].filter(Boolean)));
}

function createTicketPanelPayload(panelType = 'default') {
  const embed = new EmbedBuilder()
    .setColor(panelType === 'appeal' ? 0xf1c878 : 0x5865f2)
    .setTitle('ISP - SAVE - TICKETS')
    .setDescription([
      '> Press the button below to begin opening a ticket.',
      '> You will first choose a ticket type, then you will be prompted for your reason.',
      '> Each member may keep one open thread per ticket type at a time.',
    ].join('\n'))
    .addFields(
      {
        name: 'GENERAL SUPPORT TICKET',
        value: [
          '> Use this for questions, support requests, and internal help needs.',
          '> Choose this when you need assistance rather than filing a report.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '(SAVE) REPORT TICKET',
        value: [
          '> Reports should include pertinent information wherever possible.',
          '> Names, timestamps, evidence, and a clear summary of events should be ready before opening.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'DISCIPLINARY APPEAL TICKET',
        value: [
          '> Appeals should only be opened if you are prepared to clearly explain your position.',
          '> Be ready to provide the context, reasoning, and supporting details needed for command review.',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'ISP SAVE Ticket Intake' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${TICKET_OPEN_PANEL_PREFIX}:${panelType}`)
          .setLabel('Open Ticket')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

function createCustomTicketPanelPayload(system) {
  const embed = new EmbedBuilder()
    .setColor(getTicketTypeColor(system))
    .setTitle(buildTicketTypeName(system))
    .setDescription([
      '> Select this option below to open a private thread ticket.',
      '> You will be asked to provide your reason before the thread is created.',
    ].join('\n'))
    .addFields(
      {
        name: 'Thread Limits',
        value: `> Max open tickets per user: **${system.maxOpenTicketsPerUser}**`,
        inline: false,
      },
      {
        name: 'Support Access',
        value: `> ${system.supportRoleIds.map((id) => `<@&${id}>`).join(', ')}`,
        inline: false,
      },
    )
    .setFooter({ text: 'ISP SAVE Custom Ticket Intake' })
    .setTimestamp();

  return {
    content: system.supportRoleIds.map((id) => `<@&${id}>`).join(' '),
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${TICKET_OPEN_PANEL_PREFIX}:custom:${system.id}`)
          .setLabel(`Open ${buildTicketTypeName(system).slice(0, 70)}`)
          .setStyle(ButtonStyle.Primary),
      ),
    ],
    allowedMentions: {
      parse: [],
      roles: system.supportRoleIds,
    },
  };
}

function createIaTicketPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('ISP - IA - STATEMENTS')
    .setDescription([
      '> Use this panel only for Internal Affairs statements and related submissions.',
      '> Your ticket will be opened as a private staff-visible channel under the IA section.',
      '> Be prepared to provide factual details, timelines, and anything command may need to review.',
    ].join('\n'))
    .addFields(
      {
        name: 'What To Include',
        value: [
          '> Full and accurate statement',
          '> Names, timestamps, and relevant background',
          '> Any supporting evidence or follow-up context',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'ISP SAVE IA Statements' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(TICKET_OPEN_IA)
          .setLabel('Open IA Statement Ticket')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function createTicketPickerPayload(panelType = 'default', system = null) {
  const options = system
    ? [
        {
          label: buildTicketTypeName(system).slice(0, 100),
          description: truncate(`Open a ${buildTicketTypeName(system)} private ticket thread.`, 100),
          value: `${TICKET_OPEN_CUSTOM_PREFIX}:${system.id}`,
        },
      ]
    : buildTicketOpenOptions(panelType);

  return {
    content: 'Select the ticket type you want to open.',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TICKET_OPEN_SELECT)
          .setPlaceholder(system ? 'Select this ticket type' : 'Select a ticket type')
          .addOptions(options),
      ),
    ],
    ephemeral: true,
  };
}

function createThreadTicketPickerMessagePayload(panelType = 'default', system = null, openerUserId = '') {
  const options = system
    ? [
        {
          label: buildTicketTypeName(system).slice(0, 100),
          description: truncate(`Continue with ${buildTicketTypeName(system)}.`, 100),
          value: `${TICKET_OPEN_CUSTOM_PREFIX}:${system.id}`,
        },
      ]
    : buildTicketOpenOptions(panelType);

  const embed = new EmbedBuilder()
    .setColor(system ? getTicketTypeColor(system) : 0x5865f2)
    .setTitle('Ticket Intake')
    .setDescription([
      '> Select the ticket type for this private thread.',
      '> After you choose it, you will be prompted for your reason.',
    ].join('\n'))
    .setFooter({ text: 'ISP SAVE Ticket Intake' })
    .setTimestamp();

  return {
    content: openerUserId ? `Greetings, <@${openerUserId}>` : undefined,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TICKET_OPEN_SELECT)
          .setPlaceholder(system ? 'Select this ticket type' : 'Select a ticket type')
          .addOptions(options),
      ),
    ],
    allowedMentions: openerUserId
      ? {
          parse: [],
          users: [openerUserId],
          roles: [],
        }
      : undefined,
  };
}

function createTicketSetupPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription([
      '# Ticket Setup',
      '',
      '> Choose what you want to post in this channel.',
      '> Posted ticket panels now create private ticket threads in the same channel.',
      '> IA statement panels create dedicated ticket channels under the configured IA category.',
      '> Custom systems let you choose support roles, max tickets, and the transcript log channel.',
    ].join('\n'))
    .setFooter({ text: 'Save Assistant Ticket Setup' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_SETUP_POST_SUPPORT)
      .setLabel('Post Ticket Panel')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(TICKET_SETUP_POST_IA)
      .setLabel('Post IA Statements Panel')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(TICKET_SETUP_CREATE_CUSTOM)
      .setLabel('Create Custom System')
      .setStyle(ButtonStyle.Success),
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

function createReasonModal(type, system = null) {
  const builtInTitle = type === 'report'
    ? 'Open (SAVE) Report Ticket'
    : type === 'appeal'
      ? 'Open Appeal Ticket'
      : type === 'ia'
        ? 'Open IA Statement Ticket'
      : 'Open General Support Ticket';

  const modalId = system
    ? `${TICKET_CREATE_MODAL_CUSTOM_PREFIX}:${system.id}`
    : type === 'report'
      ? TICKET_CREATE_MODAL_REPORT
      : type === 'appeal'
        ? TICKET_CREATE_MODAL_APPEAL
        : type === 'ia'
          ? TICKET_CREATE_MODAL_IA
        : TICKET_CREATE_MODAL_GENERAL;

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(system ? `Open ${buildTicketTypeName(system)}` : builtInTitle);

  if (!system && type === 'report') {
    const yourRobloxInput = new TextInputBuilder()
      .setCustomId(TICKET_REPORT_AUTHOR_RBX_INPUT)
      .setLabel('Your Roblox Username')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter your Roblox username')
      .setRequired(true)
      .setMaxLength(60);

    const theirRobloxInput = new TextInputBuilder()
      .setCustomId(TICKET_REPORT_TARGET_RBX_INPUT)
      .setLabel('Their Roblox Username')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter their Roblox username')
      .setRequired(true)
      .setMaxLength(60);

    const incidentInput = new TextInputBuilder()
      .setCustomId(TICKET_REPORT_INCIDENT_INPUT)
      .setLabel('Incident Description')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Explain what happened. More information may still be requested.')
      .setRequired(true)
      .setMaxLength(1200);

    const evidenceInput = new TextInputBuilder()
      .setCustomId(TICKET_REPORT_EVIDENCE_INPUT)
      .setLabel('Evidence (Video Required)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Paste the video evidence link here.')
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(yourRobloxInput),
      new ActionRowBuilder().addComponents(theirRobloxInput),
      new ActionRowBuilder().addComponents(incidentInput),
      new ActionRowBuilder().addComponents(evidenceInput),
    );
    return modal;
  }

  const reasonInput = new TextInputBuilder()
    .setCustomId(TICKET_REASON_INPUT)
    .setLabel(type === 'ia' ? 'IA Statement' : 'Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(type === 'ia' ? 'Provide the statement you need to submit for Internal Affairs.' : 'Explain why you are opening this ticket.')
    .setRequired(true)
    .setMaxLength(type === 'ia' ? 2000 : 1000);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function createTicketSetupCustomModal() {
  const modal = new ModalBuilder()
    .setCustomId(TICKET_SETUP_CUSTOM_MODAL)
    .setTitle('Create Custom Ticket System');

  const nameInput = new TextInputBuilder()
    .setCustomId('system_name')
    .setLabel('System Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Example: Staff Complaints')
    .setRequired(true)
    .setMaxLength(80);

  const rolesInput = new TextInputBuilder()
    .setCustomId('support_role_ids')
    .setLabel('Support Role IDs')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Comma-separated role IDs that can access these tickets')
    .setRequired(true)
    .setMaxLength(300);

  const maxTicketsInput = new TextInputBuilder()
    .setCustomId('max_tickets')
    .setLabel('Max Open Tickets Per User')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('1-20')
    .setRequired(true)
    .setValue('1')
    .setMaxLength(2);

  const logChannelInput = new TextInputBuilder()
    .setCustomId('log_channel_id')
    .setLabel('Transcript / Log Channel ID')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Discord channel ID for close logs and transcripts')
    .setRequired(true)
    .setMaxLength(30);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(rolesInput),
    new ActionRowBuilder().addComponents(maxTicketsInput),
    new ActionRowBuilder().addComponents(logChannelInput),
  );

  return modal;
}

function createCloseModal() {
  const modal = new ModalBuilder()
    .setCustomId(TICKET_CLOSE_MODAL)
    .setTitle('Close Ticket');

  const reasonInput = new TextInputBuilder()
    .setCustomId(TICKET_CLOSE_REASON_INPUT)
    .setLabel('Reason for closing')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Explain why this ticket is being closed.')
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function buildTicketThreadOpenPayload(system, openerUserId, reason, { inviteByMention = false } = {}) {
  const instructions = system.systemId === 'report'
    ? [
        '> A support team member will review this report shortly.',
        '> Please send all relevant evidence and context here.',
      ]
    : system.systemId === 'appeal'
      ? [
          '> A supervisor will review this disciplinary appeal shortly.',
          '> Please explain the action being appealed and include any supporting evidence or context here.',
        ]
      : [
          '> A support team member will be with you shortly.',
          '> Please explain your issue in detail in this channel.',
        ];

  const embed = new EmbedBuilder()
    .setColor(getTicketTypeColor(system))
    .setDescription([
      `# ${buildTicketTypeName(system)}`,
      '',
      `> Opened by: <@${openerUserId}>`,
      `> Reason`,
      formatOpeningReasonLines(reason),
      ...instructions,
    ].join('\n'))
    .setFooter({ text: 'Save Assistant Ticket System' })
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_CLOSE)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: inviteByMention && openerUserId ? `<@${openerUserId}>` : undefined,
    embeds: [embed],
    components: [closeRow],
    allowedMentions: inviteByMention && openerUserId
      ? {
          parse: [],
          users: [openerUserId],
          roles: [],
        }
      : undefined,
  };
}

function buildTicketChannelOpenPayload(system, openerUserId, reason) {
  const instructions = system.systemId === 'ia'
    ? [
        '> Internal Affairs command has access to this ticket channel.',
        '> Keep your statement factual, complete, and ready for follow-up if more information is requested.',
      ]
    : [
        '> A support team member will review this ticket shortly.',
        '> Please keep all relevant information and evidence inside this channel.',
      ];

  const embed = new EmbedBuilder()
    .setColor(getTicketTypeColor(system))
    .setDescription([
      `# ${buildTicketTypeName(system)}`,
      '',
      `> Opened by: <@${openerUserId}>`,
      `> Reason`,
      formatOpeningReasonLines(reason),
      ...instructions,
    ].join('\n'))
    .setFooter({ text: 'Save Assistant Ticket System' })
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_CLOSE)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [closeRow],
  };
}

function buildTicketName(systemName, username, suffix = '') {
  const safePrefix = String(systemName || 'ticket')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18) || 'ticket';

  const safeName = String(username || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18) || 'user';

  const safeSuffix = String(suffix || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 12);

  return [safePrefix, safeName, safeSuffix].filter(Boolean).join('-').slice(0, 90);
}

function buildPendingTicketName(username, ticketId = '') {
  return buildTicketName('save-ticket', username, ticketId);
}

function formatQuotedLines(value, { emphasize = false } = {}) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return '> ';
      }

      return emphasize ? `> ***${trimmed}***` : `> ${trimmed}`;
    })
    .join('\n');
}

function formatOpeningReasonLines(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return '> ';
      }

      return `> ${REASON_MARKER} ***${trimmed}*** ${REASON_MARKER}`;
    })
    .join('\n');
}

function formatClosingReasonLines(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return '> ';
      }

      return `> ${REASON_MARKER} ***${trimmed}*** ${REASON_MARKER}`;
    })
    .join('\n');
}

function formatClosingReasonInline(value, maxLength = 500) {
  const trimmed = truncate(String(value || '').replace(/\s+/g, ' ').trim(), maxLength);
  return `${REASON_MARKER} ${trimmed || 'No reason provided'} ${REASON_MARKER}`;
}

function formatTranscriptTimestamp(value) {
  try {
    return new Date(value).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return 'Unknown time';
  }
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

function hasTranscriptStorageConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && TRANSCRIPT_BASE_URL);
}

async function fetchSupabaseJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Transcript storage request failed (${response.status}).`);
  }

  return data;
}

async function fetchTranscriptMessages(channel) {
  const collected = [];
  let before;

  while (collected.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });

    if (!batch.size) {
      break;
    }

    const values = Array.from(batch.values());
    collected.push(...values);

    if (batch.size < 100) {
      break;
    }

    before = values[values.length - 1]?.id;
    if (!before) {
      break;
    }
  }

  return collected
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
    .slice(-MAX_TRANSCRIPT_MESSAGES);
}

function buildTranscriptPublicUrl(publicToken) {
  return `${TRANSCRIPT_BASE_URL}/transcript.html?t=${encodeURIComponent(publicToken)}`;
}

function buildTranscriptMetaEmbed(message) {
  const author = message?.author || null;
  const member = message?.member || null;
  const avatarUrl =
    (typeof member?.displayAvatarURL === 'function'
      ? member.displayAvatarURL({ extension: 'png', size: 128 })
      : null) ||
    (typeof author?.displayAvatarURL === 'function'
      ? author.displayAvatarURL({ extension: 'png', size: 128 })
      : null) ||
    '';

  return {
    __transcriptMeta: true,
    type: 'save_transcript_meta',
    username: String(author?.username || author?.tag || ''),
    displayName: String(member?.displayName || author?.globalName || author?.username || author?.tag || ''),
    avatarUrl: String(avatarUrl || ''),
    isBot: Boolean(author?.bot),
    isSystem: Boolean(message?.system),
    messageType: Number(message?.type || 0),
  };
}

function buildSyntheticTranscriptMeta({
  displayName,
  username,
  avatarUrl,
  isBot = false,
  isSystem = true,
  messageType = MessageType.Default,
}) {
  return {
    __transcriptMeta: true,
    type: 'save_transcript_meta',
    username: String(username || ''),
    displayName: String(displayName || username || ''),
    avatarUrl: String(avatarUrl || ''),
    isBot: Boolean(isBot),
    isSystem: Boolean(isSystem),
    messageType: Number(messageType || 0),
  };
}

function buildSyntheticTranscriptMessage({
  id,
  authorId = '',
  authorTag = '',
  authorName = '',
  content = '',
  createdAt,
  embeds = [],
}) {
  return {
    message_id: String(id),
    author_discord_id: String(authorId || ''),
    author_tag: String(authorTag || ''),
    author_name: String(authorName || ''),
    content: String(content || ''),
    attachments: [],
    embeds: Array.isArray(embeds) ? embeds : [],
    created_at: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
    edited_at: null,
    sequence_no: 0,
  };
}

function buildThreadPreludeMessages({
  threadEntry,
  channel,
  opener,
  supportRoles = [],
  clientUser,
}) {
  const events = Array.isArray(threadEntry?.transcriptPrelude) ? threadEntry.transcriptPrelude : [];
  if (!events.length) {
    return [];
  }

  const botDisplayName = clientUser?.globalName || clientUser?.username || 'SAVE Assistant';
  const botTag = clientUser?.tag || clientUser?.username || 'SAVE Assistant';
  const botAvatarUrl = clientUser?.displayAvatarURL?.({ extension: 'png', size: 128 }) || '';
  const actorMeta = buildSyntheticTranscriptMeta({
    displayName: botDisplayName,
    username: clientUser?.username || 'SAVE Assistant',
    avatarUrl: botAvatarUrl,
    isBot: true,
    isSystem: true,
  });

  return events.map((event, index) => {
    if (event?.type === 'thread_created') {
      return buildSyntheticTranscriptMessage({
        id: `${threadEntry.threadId}-system-created-${index}`,
        authorId: clientUser?.id || '',
        authorTag: botTag,
        authorName: botDisplayName,
        content: `${channel?.name || 'ticket-thread'} was created as a private ticket thread.`,
        createdAt: event.createdAt,
        embeds: [actorMeta],
      });
    }

    if (event?.type === 'member_added') {
      const isOpener = String(event.memberId || '') === String(opener?.id || '');
      const memberLabel = isOpener
        ? `${opener?.displayName || opener?.user?.globalName || opener?.user?.username || 'Ticket opener'}`
        : (event.memberName || 'Support team member');
      const memberTag = isOpener
        ? (opener?.user?.tag || opener?.user?.username || '')
        : (event.memberTag || '');

      return buildSyntheticTranscriptMessage({
        id: `${threadEntry.threadId}-system-added-${index}`,
        authorId: clientUser?.id || '',
        authorTag: botTag,
        authorName: botDisplayName,
        content: `${memberLabel}${memberTag ? ` (${memberTag})` : ''} was added to the private thread.`,
        createdAt: event.createdAt,
        embeds: [actorMeta],
      });
    }

    if (event?.type === 'role_access') {
      const rolesText = supportRoles.length
        ? supportRoles.map((role) => role.name).join(', ')
        : 'Support team';

      return buildSyntheticTranscriptMessage({
        id: `${threadEntry.threadId}-system-role-${index}`,
        authorId: clientUser?.id || '',
        authorTag: botTag,
        authorName: botDisplayName,
        content: `Support access for this private thread is handled through role permissions: ${rolesText}.`,
        createdAt: event.createdAt,
        embeds: [actorMeta],
      });
    }

    return buildSyntheticTranscriptMessage({
      id: `${threadEntry.threadId}-system-generic-${index}`,
      authorId: clientUser?.id || '',
      authorTag: botTag,
      authorName: botDisplayName,
      content: String(event?.content || 'System event recorded.'),
      createdAt: event?.createdAt,
      embeds: [actorMeta],
    });
  });
}

async function cleanupThreadSystemMessages(thread) {
  if (!thread?.isThread?.()) {
    return;
  }

  try {
    const recentMessages = await thread.messages.fetch({ limit: 10 });
    const cleanupTargets = recentMessages.filter((message) =>
      message.type === MessageType.RecipientAdd
      || message.type === MessageType.ThreadCreated,
    );

    for (const message of cleanupTargets.values()) {
      await message.delete().catch(() => null);
    }
  } catch (error) {
    console.error('Thread system message cleanup failed:', error);
  }
}

function scheduleThreadSystemCleanup(thread, delayMs = 2000) {
  setTimeout(() => {
    cleanupThreadSystemMessages(thread).catch((error) => {
      console.error('Delayed thread system message cleanup failed:', error);
    });
  }, delayMs);
}

function supportRolesCanViewPrivateThreads(parentChannel, guild, supportRoleIds = []) {
  if (!parentChannel || !guild || !Array.isArray(supportRoleIds) || !supportRoleIds.length) {
    return false;
  }

  return supportRoleIds.every((roleId) => {
    const role = guild.roles?.cache?.get(roleId);
    if (!role) {
      return false;
    }

    const permissions = parentChannel.permissionsFor(role);
    return Boolean(
      permissions?.has(PermissionFlagsBits.ViewChannel)
      && permissions.has(PermissionFlagsBits.SendMessagesInThreads)
      && permissions.has(PermissionFlagsBits.ManageThreads),
    );
  });
}

async function addSupportMembersToThread(thread, guild, supportRoleIds = [], excludeUserId = '', prelude = [], threadCreatedAt = new Date()) {
  if (!thread?.isThread?.() || !guild || !Array.isArray(supportRoleIds) || !supportRoleIds.length) {
    return prelude;
  }

  const guildMembers = await guild.members.fetch().catch(() => null);
  if (!guildMembers) {
    return prelude;
  }

  const supportMembers = guildMembers
    .filter((guildMember) => supportRoleIds.some((roleId) => guildMember.roles.cache.has(roleId)))
    .filter((guildMember) => String(guildMember.id) !== String(excludeUserId));

  for (const supportMember of supportMembers.values()) {
    await thread.members.add(supportMember.id).catch(() => null);
    prelude.push({
      type: 'member_added',
      memberId: supportMember.id,
      memberName: supportMember.displayName || supportMember.user?.globalName || supportMember.user?.username || supportMember.user?.tag || supportMember.id,
      memberTag: supportMember.user?.tag || supportMember.user?.username || '',
      createdAt: new Date(threadCreatedAt.getTime() + 1000 + prelude.length).toISOString(),
    });
  }

  return prelude;
}

function serializeTranscriptMessage(message, index) {
  const transcriptMeta = buildTranscriptMetaEmbed(message);
  const messageEmbeds = Array.isArray(message.embeds)
    ? message.embeds.map((embed) => (typeof embed.toJSON === 'function' ? embed.toJSON() : embed))
    : [];

  return {
    message_id: String(message.id),
    author_discord_id: String(message.author?.id || ''),
    author_tag: String(message.author?.tag || ''),
    author_name: String(message.member?.displayName || message.author?.globalName || message.author?.username || ''),
    content: String(message.content || ''),
    attachments: Array.from(message.attachments.values()).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType || null,
      size: attachment.size,
    })),
    embeds: [transcriptMeta, ...messageEmbeds],
    created_at: message.createdAt ? new Date(message.createdAt).toISOString() : null,
    edited_at: message.editedAt ? new Date(message.editedAt).toISOString() : null,
    sequence_no: index + 1,
  };
}

async function insertTranscriptMessages(transcriptId, messages) {
  if (!messages.length) {
    return;
  }

  const chunkSize = 250;
  for (let index = 0; index < messages.length; index += chunkSize) {
    const chunk = messages.slice(index, index + chunkSize).map((message) => ({
      transcript_id: transcriptId,
      ...message,
    }));

    await fetchSupabaseJson(`${SUPABASE_URL}/rest/v1/ticket_transcript_messages`, {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(chunk),
    });
  }
}

async function saveTicketTranscript({
  channel,
  ticketInfo,
  ticketTypeLabel,
  opener,
  closer,
  closeReason,
}) {
  if (!hasTranscriptStorageConfig()) {
    return null;
  }

  const threadEntry = getThreadEntry(channel.id);
  const supportRoles = Array.isArray(threadEntry?.supportRoleIds)
    ? threadEntry.supportRoleIds
      .map((roleId) => channel.guild?.roles?.cache?.get(roleId))
      .filter(Boolean)
    : [];
  const preludeMessages = buildThreadPreludeMessages({
    threadEntry,
    channel,
    opener,
    supportRoles,
    clientUser: channel.client?.user || null,
  });
  const fetchedMessages = await fetchTranscriptMessages(channel);
  const messages = [...preludeMessages, ...fetchedMessages];
  const publicToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const openedAt = messages[0]?.createdAt ? new Date(messages[0].createdAt).toISOString() : null;
  const closedAt = new Date().toISOString();

  const transcriptRows = await fetchSupabaseJson(`${SUPABASE_URL}/rest/v1/ticket_transcripts`, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      public_token: publicToken,
      guild_id: String(channel.guild?.id || ''),
      channel_id: String(channel.id),
      channel_name: String(channel.name || ''),
      ticket_system_id: String(ticketInfo.systemId || ''),
      ticket_type_label: String(ticketTypeLabel || 'Ticket'),
      opener_discord_id: String(ticketInfo.ownerId || ''),
      opener_tag: String(opener?.tag || opener?.username || ''),
      closer_discord_id: String(closer?.id || ''),
      closer_tag: String(closer?.tag || closer?.username || ''),
      close_reason: String(closeReason || ''),
      transcript_message_count: messages.length,
      opened_at: openedAt,
      closed_at: closedAt,
    }),
  });

  const transcript = Array.isArray(transcriptRows) ? transcriptRows[0] || null : null;
  if (!transcript?.id) {
    throw new Error('Transcript metadata insert did not return a transcript ID.');
  }

  await insertTranscriptMessages(
    transcript.id,
    messages.map((message, index) => (
      typeof message?.message_id === 'string'
        ? { ...message, sequence_no: index + 1 }
        : serializeTranscriptMessage(message, index)
    )),
  );

  return {
    publicToken,
    url: buildTranscriptPublicUrl(publicToken),
    messageCount: messages.length,
  };
}

async function resolveTicketSystem(systemId, options = {}) {
  if (systemId === 'general') {
    return {
      ...BUILT_IN_SYSTEMS.general,
      supportRoleIds: [GENERAL_TICKET_SUPPORT_ROLE_ID].filter(Boolean),
      maxOpenTicketsPerUser: 1,
      logChannelId: options.ticketLogChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
    };
  }

  if (systemId === 'report') {
    return {
      ...BUILT_IN_SYSTEMS.report,
      supportRoleIds: [REPORT_APPEAL_SUPPORT_ROLE_ID].filter(Boolean),
      maxOpenTicketsPerUser: 1,
      logChannelId: options.ticketLogChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
    };
  }

  if (systemId === 'appeal') {
    return {
      ...BUILT_IN_SYSTEMS.appeal,
      supportRoleIds: [REPORT_APPEAL_SUPPORT_ROLE_ID].filter(Boolean),
      maxOpenTicketsPerUser: 1,
      logChannelId: options.ticketLogChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
    };
  }

  if (systemId === 'ia' || systemId === IA_TICKET_SYSTEM_ID) {
    return {
      ...BUILT_IN_SYSTEMS.ia,
      supportRoleIds: [IA_TICKET_SUPPORT_ROLE_ID].filter(Boolean),
      maxOpenTicketsPerUser: 1,
      logChannelId: IA_TICKET_LOG_CHANNEL_ID || options.ticketLogChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
      mode: 'channel',
      categoryId: IA_TICKET_PARENT_CATEGORY_ID,
      channelNamePrefix: 'ia-statement',
      omitUsernameInChannelName: true,
    };
  }

  const customSystem = getCustomSystemById(systemId);
  if (!customSystem) {
    return null;
  }

  return {
    systemId: customSystem.id,
    type: 'custom',
    label: customSystem.name,
    color: Number(customSystem.color) || 0x4a9fd4,
    supportRoleIds: customSystem.supportRoleIds,
    maxOpenTicketsPerUser: customSystem.maxOpenTicketsPerUser,
    logChannelId: customSystem.logChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
    mode: customSystem.mode || 'thread',
    categoryId: customSystem.categoryId || null,
    channelNamePrefix: customSystem.channelNamePrefix || null,
    omitUsernameInChannelName: Boolean(customSystem.omitUsernameInChannelName),
  };
}

async function resolveTicketLogChannel(client, channelId, guild = null) {
  const resolvedChannelId = channelId || DEFAULT_TICKET_LOG_CHANNEL_ID;
  if (!resolvedChannelId) {
    return null;
  }

  const guildChannel = guild?.channels?.cache?.get(resolvedChannelId)
    || await guild?.channels?.fetch?.(resolvedChannelId).catch(() => null);
  const channel = guildChannel
    || client.channels.cache.get(resolvedChannelId)
    || await client.channels.fetch(resolvedChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

async function sendTicketCloseLog({
  interaction,
  logChannelId,
  ticketTypeLabel,
  ownerId,
  closeReason,
  transcriptUrl,
  transcriptMessageCount,
}) {
  appendTicketDebug('sendTicketCloseLog:start', {
    requestedLogChannelId: logChannelId || null,
    fallbackLogChannelId: DEFAULT_TICKET_LOG_CHANNEL_ID || null,
    ticketTypeLabel,
    ownerId,
    closerId: interaction.user?.id || null,
    ticketChannelId: interaction.channelId || null,
    transcriptUrl: transcriptUrl || null,
    transcriptMessageCount: transcriptMessageCount ?? null,
  });

  const logChannel = await resolveTicketLogChannel(interaction.client, logChannelId, interaction.guild || null);
  if (!logChannel) {
    const details = {
      requestedLogChannelId: logChannelId || null,
      fallbackLogChannelId: DEFAULT_TICKET_LOG_CHANNEL_ID || null,
    };
    console.error('Ticket close log channel could not be resolved.', details);
    appendTicketDebug('sendTicketCloseLog:no-channel', details);
    throw new Error('Ticket close log channel could not be resolved.');
  }

  const mentionUserIds = Array.from(new Set([ownerId, interaction.user.id].filter(Boolean)));
  const mentionLine = mentionUserIds.map((userId) => `<@${userId}>`).join(' ');

  const embed = new EmbedBuilder()
    .setColor(0x99aab5)
    .setTitle('Ticket Closed')
    .setDescription('A managed ticket has been closed and archived by Save Assistant.')
    .addFields(
      { name: 'Ticket Type', value: truncate(ticketTypeLabel, 200), inline: true },
      { name: 'Ticket Channel', value: interaction.channelId ? `<#${interaction.channelId}>` : 'Unknown', inline: true },
      { name: 'Transcript Messages', value: String(transcriptMessageCount ?? 0), inline: true },
      { name: 'Opened By', value: `<@${ownerId}>`, inline: true },
      { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Transcript Link', value: transcriptUrl ? `[Open Transcript](${transcriptUrl})` : 'Transcript unavailable', inline: false },
      { name: 'Reason for Closing', value: formatClosingReasonInline(closeReason, 1000), inline: false },
    )
    .setFooter({ text: 'Save Assistant Ticket Logs' })
    .setTimestamp();

  try {
    await logChannel.send({
      content: mentionLine || undefined,
      embeds: [embed],
      allowedMentions: {
        parse: [],
        users: mentionUserIds,
        roles: [],
      },
    });
    appendTicketDebug('sendTicketCloseLog:rich-success', {
      logChannelId: logChannel.id,
    });
  } catch (error) {
    console.error('Rich ticket close log failed, using fallback:', error);
    appendTicketDebug('sendTicketCloseLog:rich-failed', {
      logChannelId: logChannel.id,
      error: error?.message || String(error),
    });
    await logChannel.send({
      content: [
        mentionLine,
        `Ticket closed: ${ticketTypeLabel}`,
        `Reason: ${formatClosingReasonInline(closeReason, 500)}`,
        `Transcript: ${transcriptUrl || 'Unavailable'}`,
      ].filter(Boolean).join('\n'),
      allowedMentions: {
        parse: [],
        users: mentionUserIds,
        roles: [],
      },
    });
    appendTicketDebug('sendTicketCloseLog:fallback-success', {
      logChannelId: logChannel.id,
    });
  }
}

async function openTicketIntakeThread(interaction, { panelType = 'default', system = null } = {}) {
  if (!interaction.inGuild()) {
    await interaction.editReply('Tickets can only be opened inside a server.');
    return;
  }

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.editReply('Private ticket threads can only be opened from a standard text channel.');
    return;
  }

  const openerMember =
    interaction.member ??
    (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

  const supportRoleIds = resolveIntakeSupportRoleIds(panelType, system);

  const hasVerifiedRole = Boolean(openerMember?.roles?.cache?.has(TICKET_OPEN_REQUIRED_ROLE_ID));
  const hasSupportRole = Boolean(supportRoleIds.some((roleId) => openerMember?.roles?.cache?.has(roleId)));

  if (!hasVerifiedRole && !hasSupportRole) {
    await interaction.editReply('You must be verified before opening SAVE tickets.');
    return;
  }

  await pruneMissingThreadEntries(interaction.client, (item) =>
    String(item.parentChannelId) === String(interaction.channelId)
    && String(item.ownerId) === String(interaction.user.id)
    && String(item.status) === 'pending',
  );

  const pendingTickets = countPendingThreadEntries({
    parentChannelId: interaction.channelId,
    ownerId: interaction.user.id,
  });

  if (pendingTickets >= 1) {
    await interaction.editReply('You already have a ticket intake thread open here.');
    return;
  }

  const me =
    interaction.guild.members.me ||
    (await interaction.guild.members.fetchMe().catch(() => null));

  if (!me) {
    await interaction.editReply('I could not verify my own server permissions.');
    return;
  }

  const permissions = interaction.channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    await interaction.editReply('I need permission to view this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    await interaction.editReply('I need permission to send messages in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    await interaction.editReply('I need permission to embed links in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.CreatePrivateThreads)) {
    await interaction.editReply('I need permission to create private threads in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
    await interaction.editReply('I need permission to send messages in threads in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.ManageThreads)) {
    await interaction.editReply('I need permission to manage private threads in this channel.');
    return;
  }

  const ticketId = randomUUID().slice(0, 8);
  const threadCreatedAt = new Date();
  const channel = await interaction.channel.threads.create({
    name: buildPendingTicketName(interaction.user.username, ticketId),
    type: ChannelType.PrivateThread,
    autoArchiveDuration: 1440,
    invitable: false,
    reason: `Ticket intake opened by ${interaction.user.tag}`,
  });

  const transcriptPrelude = [
    {
      type: 'thread_created',
      createdAt: threadCreatedAt.toISOString(),
    },
  ];

  if (supportRoleIds.length) {
    transcriptPrelude.push({
      type: 'role_access',
      createdAt: new Date(threadCreatedAt.getTime() + 1000).toISOString(),
    });
  }

  const intakeMessage = await channel.send(
    createThreadTicketPickerMessagePayload(panelType, system, interaction.user.id),
  );

  upsertThreadEntry({
    threadId: channel.id,
    parentChannelId: interaction.channelId,
    systemId: TICKET_PENDING_SYSTEM_ID,
    ownerId: interaction.user.id,
    ticketId,
    status: 'pending',
    logChannelId: system?.logChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
    supportRoleIds: Array.isArray(system?.supportRoleIds) ? system.supportRoleIds : [],
    transcriptPrelude,
    intakeMessageId: intakeMessage.id,
    pendingPanelType: panelType,
    pendingSystemId: system?.id || null,
    createdAt: new Date().toISOString(),
  });

  await interaction.editReply(`Your ticket thread is ready: <#${channel.id}>`);
}

async function createFinalTicketThread({ interaction, parentChannel, system, reason }) {
  if (!parentChannel || parentChannel.type !== ChannelType.GuildText) {
    throw new Error('Private ticket threads can only be created from a standard text channel.');
  }

  const me =
    interaction.guild.members.me ||
    (await interaction.guild.members.fetchMe().catch(() => null));

  if (!me) {
    throw new Error('I could not verify my own server permissions.');
  }

  const permissions = parentChannel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error('I need permission to view this channel.');
  }

  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    throw new Error('I need permission to send messages in this channel.');
  }

  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    throw new Error('I need permission to embed links in this channel.');
  }

  if (!permissions.has(PermissionFlagsBits.CreatePrivateThreads)) {
    throw new Error('I need permission to create private threads in this channel.');
  }

  if (!permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
    throw new Error('I need permission to send messages in threads in this channel.');
  }

  if (!permissions.has(PermissionFlagsBits.ManageThreads)) {
    throw new Error('I need permission to manage private threads in this channel.');
  }

  const ticketId = randomUUID().slice(0, 8);
  const threadCreatedAt = new Date();
  const channel = await parentChannel.threads.create({
    name: buildTicketName(system.label, interaction.user.username, ticketId),
    type: ChannelType.PrivateThread,
    autoArchiveDuration: 1440,
    invitable: false,
    reason: `Ticket opened by ${interaction.user.tag}`,
  });

  const transcriptPrelude = [
    {
      type: 'thread_created',
      createdAt: threadCreatedAt.toISOString(),
    },
  ];

  if (system.supportRoleIds.length) {
    transcriptPrelude.push({
      type: 'role_access',
      createdAt: new Date(threadCreatedAt.getTime() + 1000).toISOString(),
    });
  }

  upsertThreadEntry({
    threadId: channel.id,
    parentChannelId: parentChannel.id,
    systemId: system.systemId,
    ownerId: interaction.user.id,
    ticketId,
    status: 'open',
    logChannelId: system.logChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
    supportRoleIds: system.supportRoleIds,
    transcriptPrelude,
    createdAt: new Date().toISOString(),
  });

  await channel.send(buildTicketThreadOpenPayload(system, interaction.user.id, reason, { inviteByMention: true }));
  return channel;
}

async function finalizePendingTicketThread(interaction, { system, reason, ticketInfo }) {
  if (!interaction.channel?.isThread?.()) {
    await interaction.editReply('I could not find the pending ticket thread for this request.');
    return;
  }

  if (!ticketInfo || ticketInfo.ownerId !== interaction.user.id) {
    await interaction.editReply('Only the ticket opener can finish this ticket intake.');
    return;
  }

  if (!Array.isArray(system.supportRoleIds) || !system.supportRoleIds.length) {
    await interaction.editReply('This ticket system is missing its support role configuration.');
    return;
  }

  await pruneMissingThreadEntries(interaction.client, (item) =>
    String(item.parentChannelId) === String(ticketInfo.parentChannelId || interaction.channel.parentId)
    && String(item.systemId) === String(system.systemId)
    && String(item.ownerId) === String(interaction.user.id)
    && item.status !== 'closed',
  );

  const matchingOpenTickets = countOpenThreadEntries({
    parentChannelId: ticketInfo.parentChannelId || interaction.channel.parentId,
    systemId: system.systemId,
    ownerId: interaction.user.id,
  });

  if (matchingOpenTickets >= Number(system.maxOpenTicketsPerUser || 1)) {
    await interaction.editReply(`You already reached the max open ticket limit for ${buildTicketTypeName(system)}.`);
    return;
  }

  const threadEntry = getThreadEntry(interaction.channel.id);
  if (!threadEntry) {
    await interaction.editReply('I could not find the stored ticket intake for this thread.');
    return;
  }

  if (threadEntry.intakeMessageId) {
    const intakeMessage = await interaction.channel.messages.fetch(threadEntry.intakeMessageId).catch(() => null);
    await intakeMessage?.delete().catch(() => null);
  }

  await interaction.channel.setName(
    buildTicketName(system.label, interaction.user.username, threadEntry.ticketId),
    `Ticket type selected by ${interaction.user.tag}`,
  ).catch(() => null);

  upsertThreadEntry({
    ...threadEntry,
    systemId: system.systemId,
    status: 'open',
    logChannelId: system.logChannelId || DEFAULT_TICKET_LOG_CHANNEL_ID,
    supportRoleIds: system.supportRoleIds,
    intakeMessageId: null,
    pendingPanelType: null,
    pendingSystemId: null,
    openedAt: new Date().toISOString(),
  });

  await interaction.channel.send(buildTicketThreadOpenPayload(system, interaction.user.id, reason));
  await interaction.editReply(`Your ${buildTicketTypeName(system)} has been created: <#${interaction.channel.id}>`);
}

async function createManagedTicketChannel(interaction, { system, reason }) {
  if (!interaction.inGuild()) {
    await interaction.editReply('Tickets can only be opened inside a server.');
    return;
  }

  if (!system?.categoryId) {
    await interaction.editReply('This ticket system is missing its category configuration.');
    return;
  }

  if (!Array.isArray(system.supportRoleIds) || !system.supportRoleIds.length) {
    await interaction.editReply('This ticket system is missing its support role configuration.');
    return;
  }

  const openerMember =
    interaction.member ??
    (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

  const hasVerifiedRole = Boolean(openerMember?.roles?.cache?.has(TICKET_OPEN_REQUIRED_ROLE_ID));
  const hasSupportRole = Boolean(system.supportRoleIds.some((roleId) => openerMember?.roles?.cache?.has(roleId)));

  if (!hasVerifiedRole && !hasSupportRole) {
    await interaction.editReply('You must be verified before opening SAVE tickets.');
    return;
  }

  const matchingOpenTickets = await countOpenManagedChannels({
    guild: interaction.guild,
    systemId: system.systemId,
    ownerId: interaction.user.id,
    categoryId: system.categoryId,
  });

  if (matchingOpenTickets >= Number(system.maxOpenTicketsPerUser || 1)) {
    await interaction.editReply(`You already reached the max open ticket limit for ${buildTicketTypeName(system)}.`);
    return;
  }

  const me =
    interaction.guild.members.me ||
    (await interaction.guild.members.fetchMe().catch(() => null));

  if (!me) {
    await interaction.editReply('I could not verify my own server permissions.');
    return;
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.editReply('I need permission to manage channels before I can open this ticket system.');
    return;
  }

  const categoryChannel = interaction.guild.channels.cache.get(system.categoryId)
    || await interaction.guild.channels.fetch(system.categoryId).catch(() => null);

  if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
    await interaction.editReply('The IA ticket category could not be found.');
    return;
  }

  const ticketId = randomUUID().slice(0, 8);
  const channelName = buildManagedChannelTicketName(system, ticketId);
  const channelTopic = `ticket:${system.systemId}:${interaction.user.id}:${ticketId}`;
  const everyoneRoleId = interaction.guild.roles.everyone?.id;
  const supportRoleIds = Array.from(new Set(system.supportRoleIds.filter(Boolean)));

  const permissionOverwrites = [
    {
      id: everyoneRoleId,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    ...supportRoleIds.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    })),
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: channelTopic,
    parent: categoryChannel.id,
    reason: `${buildTicketTypeName(system)} opened by ${interaction.user.tag}`,
    permissionOverwrites,
  });

  await channel.send(buildTicketChannelOpenPayload(system, interaction.user.id, reason));
  await interaction.editReply(`Your ${buildTicketTypeName(system)} has been created: <#${channel.id}>`);
}

async function createTicketChannel(interaction, { system, reason }) {
  if (system?.mode === 'channel') {
    await createManagedTicketChannel(interaction, { system, reason });
    return;
  }

  const ticketInfo = getManagedTicketContext(interaction.channel);
  if (
    interaction.channel?.isThread?.()
    && ticketInfo?.mode === 'thread'
    && ticketInfo.systemId === TICKET_PENDING_SYSTEM_ID
  ) {
    await finalizePendingTicketThread(interaction, { system, reason, ticketInfo });
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.editReply('Tickets can only be opened inside a server.');
    return;
  }

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.editReply('Private ticket threads can only be opened from a standard text channel.');
    return;
  }

  if (!Array.isArray(system.supportRoleIds) || !system.supportRoleIds.length) {
    await interaction.editReply('This ticket system is missing its support role configuration.');
    return;
  }

  const openerMember =
    interaction.member ??
    (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

  const hasVerifiedRole = Boolean(openerMember?.roles?.cache?.has(TICKET_OPEN_REQUIRED_ROLE_ID));
  const hasSupportRole = Boolean(system.supportRoleIds.some((roleId) => openerMember?.roles?.cache?.has(roleId)));

  if (!hasVerifiedRole && !hasSupportRole) {
    await interaction.editReply('You must be verified before opening SAVE tickets.');
    return;
  }

  await pruneMissingThreadEntries(interaction.client, (item) =>
    String(item.parentChannelId) === String(interaction.channelId)
    && String(item.systemId) === String(system.systemId)
    && String(item.ownerId) === String(interaction.user.id)
    && item.status !== 'closed',
  );

  const matchingOpenTickets = countOpenThreadEntries({
    parentChannelId: interaction.channelId,
    systemId: system.systemId,
    ownerId: interaction.user.id,
  });

  if (matchingOpenTickets >= Number(system.maxOpenTicketsPerUser || 1)) {
    await interaction.editReply(`You already reached the max open ticket limit for ${buildTicketTypeName(system)}.`);
    return;
  }

  const me =
    interaction.guild.members.me ||
    (await interaction.guild.members.fetchMe().catch(() => null));

  if (!me) {
    await interaction.editReply('I could not verify my own server permissions.');
    return;
  }

  const permissions = interaction.channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    await interaction.editReply('I need permission to view this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    await interaction.editReply('I need permission to send messages in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    await interaction.editReply('I need permission to embed links in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.CreatePrivateThreads)) {
    await interaction.editReply('I need permission to create private threads in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
    await interaction.editReply('I need permission to send messages in threads in this channel.');
    return;
  }

  if (!permissions.has(PermissionFlagsBits.ManageThreads)) {
    await interaction.editReply('I need permission to manage private threads in this channel.');
    return;
  }

  const ticketId = randomUUID().slice(0, 8);
  const threadCreatedAt = new Date();
  const channel = await createFinalTicketThread({
    interaction,
    parentChannel: interaction.channel,
    system,
    reason,
  });

  await interaction.editReply(`Your ${buildTicketTypeName(system)} has been created: <#${channel.id}>`);
}

async function closeTicket(interaction, options, closeReason) {
  if (!interaction.inGuild() || !interaction.channel) {
    await interaction.editReply('This form only works inside a ticket channel.');
    return;
  }

  const ticketInfo = getManagedTicketContext(interaction.channel);
  if (!ticketInfo) {
    await interaction.editReply('This is not a managed ticket channel.');
    return;
  }

  const system = await resolveTicketSystem(ticketInfo.systemId, options);
  if (!system) {
    await interaction.editReply('I could not resolve the ticket system for this channel.');
    return;
  }

  const member =
    interaction.member ??
    (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

  const closeRoleId = String(options.supportRoleId || '').trim();
  const canCloseTicket = Boolean(
    (closeRoleId && member?.roles?.cache?.has(closeRoleId))
    || system.supportRoleIds?.some((roleId) => member?.roles?.cache?.has(roleId)),
  );

  if (!canCloseTicket) {
    await interaction.editReply('Only authorized SAVE supervisors can close tickets.');
    return;
  }

  const opener = await interaction.client.users.fetch(ticketInfo.ownerId).catch(() => null);
  let transcript = null;

  appendTicketDebug('closeTicket:start', {
    ticketSystemId: ticketInfo.systemId,
    ticketOwnerId: ticketInfo.ownerId,
    closerId: interaction.user?.id || null,
    ticketChannelId: interaction.channelId || null,
  });

  try {
    transcript = await saveTicketTranscript({
      channel: interaction.channel,
      ticketInfo,
      ticketTypeLabel: buildTicketTypeName(system),
      opener,
      closer: interaction.user,
      closeReason,
    });
  } catch (error) {
    console.error('Ticket transcript save failed:', error);
    appendTicketDebug('closeTicket:transcript-failed', {
      error: error?.message || String(error),
    });
    transcript = null;
  }

  try {
    await sendTicketCloseLog({
      interaction,
      logChannelId: system.logChannelId,
      ticketTypeLabel: buildTicketTypeName(system),
      ownerId: ticketInfo.ownerId,
      closeReason,
      transcriptUrl: transcript?.url || null,
      transcriptMessageCount: transcript?.messageCount || 0,
    });
  } catch (error) {
    console.error('Ticket close log failed:', error);
    appendTicketDebug('closeTicket:log-failed', {
      error: error?.message || String(error),
    });
  }

  let dmSent = false;
  if (opener) {
    const dmEmbed = new EmbedBuilder()
      .setColor(0x99aab5)
      .setDescription([
        '# Ticket Closed',
        '',
        `> Ticket Type: ${buildTicketTypeName(system)}`,
        `> Reason for Closing`,
        formatClosingReasonLines(closeReason),
      ].join('\n'))
      .setFooter({ text: 'Save Assistant Ticket System' })
      .setTimestamp();

    const notification = await sendUserNotification({
      client: interaction.client,
      user: opener,
      embeds: [dmEmbed],
      fallbackPrefix: 'Ticket closure DM delivery failed. Posting the closure notice here instead.',
    }).catch(() => ({ deliveredVia: 'failed' }));

    dmSent = notification.deliveredVia === 'dm' || notification.deliveredVia === 'fallback';
  }

  await interaction.editReply(
    dmSent
      ? 'Closing ticket, saving transcript, and notifying the opener...'
      : 'Closing ticket and saving transcript.',
  );

  if (ticketInfo.mode === 'thread' && typeof interaction.channel.setLocked === 'function' && typeof interaction.channel.setArchived === 'function') {
    const threadEntry = getThreadEntry(interaction.channel.id);
    if (threadEntry) {
      upsertThreadEntry({
        ...threadEntry,
        status: 'closed',
        closedAt: new Date().toISOString(),
      });
    }

    await interaction.channel.setLocked(true, `Ticket closed by ${interaction.user.tag}`).catch((error) => {
      console.error('Ticket thread lock failed:', error);
    });
    await interaction.channel.setArchived(true, `Ticket closed by ${interaction.user.tag}`).catch((error) => {
      console.error('Ticket thread archive failed:', error);
    });

    setTimeout(() => {
      interaction.channel
        .delete(`Ticket thread closed by ${interaction.user.tag}`)
        .then(() => removeThreadEntry(interaction.channel.id))
        .catch((error) => console.error('Ticket thread delete failed:', error));
    }, TICKET_THREAD_DELETE_DELAY_MS);
    return;
  }

  setTimeout(() => {
    interaction.channel
      .delete(`Ticket closed by ${interaction.user.tag}`)
      .catch((error) => console.error('Ticket delete failed:', error));
  }, 1500);
}

async function handleTicketButtonInteraction(interaction, options) {
  if (interaction.customId === TICKET_SETUP_POST_SUPPORT) {
    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.update({ content: 'I can only post ticket panels in a text channel.', embeds: [], components: [] });
      return;
    }

    await interaction.channel.send(createTicketPanelPayload());
    await interaction.update({ content: 'Support ticket panel sent in this channel.', embeds: [], components: [] });
    return;
  }

  if (interaction.customId === TICKET_SETUP_POST_IA) {
    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.update({ content: 'I can only post ticket panels in a text channel.', embeds: [], components: [] });
      return;
    }

    await interaction.channel.send(createIaTicketPanelPayload());
    await interaction.update({ content: 'IA statements panel sent in this channel.', embeds: [], components: [] });
    return;
  }

  if (interaction.customId === TICKET_SETUP_CREATE_CUSTOM) {
    await interaction.showModal(createTicketSetupCustomModal());
    return;
  }

  if (interaction.customId === `${TICKET_OPEN_PANEL_PREFIX}:default`) {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    await openTicketIntakeThread(interaction, { panelType: 'default' }).catch(async (error) => {
      console.error('Ticket intake thread create failed:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('I could not open that ticket thread right now.').catch(() => null);
      }
    });
    return;
  }

  if (interaction.customId === `${TICKET_OPEN_PANEL_PREFIX}:appeal`) {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    await openTicketIntakeThread(interaction, { panelType: 'appeal' }).catch(async (error) => {
      console.error('Appeal intake thread create failed:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('I could not open that ticket thread right now.').catch(() => null);
      }
    });
    return;
  }

  if (interaction.customId === TICKET_OPEN_IA) {
    await interaction.showModal(createReasonModal('ia'));
    return;
  }

  if (interaction.customId.startsWith(`${TICKET_OPEN_PANEL_PREFIX}:custom:`)) {
    const systemId = interaction.customId.slice(`${TICKET_OPEN_PANEL_PREFIX}:custom:`.length);
    const system = getCustomSystemById(systemId);

    if (!system) {
      await interaction.reply({
        content: 'That custom ticket system no longer exists.',
        ephemeral: true,
      }).catch(() => null);
      return;
    }

    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    await openTicketIntakeThread(interaction, { panelType: 'custom', system }).catch(async (error) => {
      console.error('Custom intake thread create failed:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('I could not open that ticket thread right now.').catch(() => null);
      }
    });
    return;
  }

  if (interaction.customId === TICKET_OPEN_GENERAL) {
    await interaction.showModal(createReasonModal('general'));
    return;
  }

  if (interaction.customId === TICKET_OPEN_REPORT) {
    await interaction.showModal(createReasonModal('report'));
    return;
  }

  if (interaction.customId === TICKET_OPEN_APPEAL) {
    await interaction.showModal(createReasonModal('appeal'));
    return;
  }

  if (interaction.customId.startsWith(`${TICKET_OPEN_CUSTOM_PREFIX}:`)) {
    const systemId = interaction.customId.slice(`${TICKET_OPEN_CUSTOM_PREFIX}:`.length);
    const system = getCustomSystemById(systemId);

    if (!system) {
      await interaction.reply({
        content: 'That custom ticket system no longer exists.',
        ephemeral: true,
      }).catch(() => null);
      return;
    }

    await interaction.showModal(createReasonModal('custom', system));
    return;
  }

  if (interaction.customId === TICKET_CLOSE) {
    const ticketInfo = getManagedTicketContext(interaction.channel);
    if (!ticketInfo) {
      await interaction.reply({
        content: 'This button only works inside a managed ticket thread.',
        ephemeral: true,
      }).catch(() => null);
      return;
    }

    const system = await resolveTicketSystem(ticketInfo.systemId, options);
    if (!system) {
      await interaction.reply({
        content: 'I could not resolve the ticket system for this thread.',
        ephemeral: true,
      }).catch(() => null);
      return;
    }

    const member =
      interaction.member ??
      (interaction.inGuild()
        ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
        : null);

    const closeRoleId = String(options.supportRoleId || '').trim();
    const canCloseTicket = Boolean(
      (closeRoleId && member?.roles?.cache?.has(closeRoleId))
      || system.supportRoleIds?.some((roleId) => member?.roles?.cache?.has(roleId)),
    );

    if (!canCloseTicket) {
      await interaction.reply({
        content: 'Only authorized SAVE supervisors can close tickets.',
        ephemeral: true,
      }).catch(() => null);
      return;
    }

    await interaction.showModal(createCloseModal());
  }
}

async function handleTicketSelectInteraction(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== TICKET_OPEN_SELECT) {
    return false;
  }

  const ticketInfo = getManagedTicketContext(interaction.channel);
  if (
    ticketInfo?.mode === 'thread'
    && ticketInfo.systemId === TICKET_PENDING_SYSTEM_ID
    && String(ticketInfo.ownerId) !== String(interaction.user.id)
  ) {
    await interaction.reply({
      content: 'Only the ticket opener can choose the ticket type for this thread.',
      ephemeral: true,
    }).catch(() => null);
    return true;
  }

  const selected = interaction.values?.[0];
  if (!selected) {
    await interaction.reply({
      content: 'Select a ticket type first.',
      ephemeral: true,
    }).catch(() => null);
    return true;
  }

  if (selected === TICKET_OPEN_GENERAL) {
    await interaction.showModal(createReasonModal('general'));
    return true;
  }

  if (selected === TICKET_OPEN_REPORT) {
    await interaction.showModal(createReasonModal('report'));
    return true;
  }

  if (selected === TICKET_OPEN_APPEAL) {
    await interaction.showModal(createReasonModal('appeal'));
    return true;
  }

  if (selected.startsWith(`${TICKET_OPEN_CUSTOM_PREFIX}:`)) {
    const systemId = selected.slice(`${TICKET_OPEN_CUSTOM_PREFIX}:`.length);
    const system = getCustomSystemById(systemId);

    if (!system) {
      await interaction.reply({
        content: 'That custom ticket system no longer exists.',
        ephemeral: true,
      }).catch(() => null);
      return true;
    }

    await interaction.showModal(createReasonModal('custom', system));
    return true;
  }

  return false;
}

async function handleTicketModalInteraction(interaction, options) {
  if (interaction.customId === TICKET_SETUP_CUSTOM_MODAL) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const systemName = sanitizeSystemName(interaction.fields.getTextInputValue('system_name'));
      const supportRoleIds = parseRoleIds(interaction.fields.getTextInputValue('support_role_ids'));
      const maxOpenTicketsPerUser = parseMaxTickets(interaction.fields.getTextInputValue('max_tickets'));
      const logChannelId = sanitizeChannelId(interaction.fields.getTextInputValue('log_channel_id'));

      const customSystems = loadCustomSystems();
      const customSystem = {
        id: buildCustomSystemId(systemName),
        name: systemName,
        supportRoleIds,
        maxOpenTicketsPerUser,
        logChannelId,
        createdAt: new Date().toISOString(),
        createdBy: interaction.user.id,
      };

      customSystems.push(customSystem);
      saveCustomSystems(customSystems);

      if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.editReply('The custom system was saved, but I could not post its panel in this channel.');
        return;
      }

      await interaction.channel.send(createCustomTicketPanelPayload(customSystem));
      await interaction.editReply(`Custom ticket system created and posted here: **${systemName}**`);
    } catch (error) {
      console.error('Custom ticket setup failed:', error);
      await interaction.editReply(error.message || 'I could not create that custom ticket system.');
    }

    return;
  }

  if (interaction.customId === TICKET_CREATE_MODAL_GENERAL) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await createTicketChannel(interaction, {
        system: await resolveTicketSystem('general', options),
        reason: interaction.fields.getTextInputValue(TICKET_REASON_INPUT),
      });
    } catch (error) {
      console.error('General ticket create failed:', error);
      await interaction.editReply('I could not create that ticket right now.');
    }
    return;
  }

  if (interaction.customId === TICKET_CREATE_MODAL_REPORT) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const reportReason = [
        'Your Roblox Username',
        interaction.fields.getTextInputValue(TICKET_REPORT_AUTHOR_RBX_INPUT),
        '',
        'Their Roblox Username',
        interaction.fields.getTextInputValue(TICKET_REPORT_TARGET_RBX_INPUT),
        '',
        'Incident Description',
        interaction.fields.getTextInputValue(TICKET_REPORT_INCIDENT_INPUT),
        '',
        'Evidence (Video Required)',
        interaction.fields.getTextInputValue(TICKET_REPORT_EVIDENCE_INPUT),
      ].join('\n');

      await createTicketChannel(interaction, {
        system: await resolveTicketSystem('report', options),
        reason: reportReason,
      });
    } catch (error) {
      console.error('Report ticket create failed:', error);
      await interaction.editReply('I could not create that ticket right now.');
    }
    return;
  }

  if (interaction.customId === TICKET_CREATE_MODAL_APPEAL) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await createTicketChannel(interaction, {
        system: await resolveTicketSystem('appeal', options),
        reason: interaction.fields.getTextInputValue(TICKET_REASON_INPUT),
      });
    } catch (error) {
      console.error('Appeal ticket create failed:', error);
      await interaction.editReply('I could not create that ticket right now.');
    }
    return;
  }

  if (interaction.customId === TICKET_CREATE_MODAL_IA) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await createTicketChannel(interaction, {
        system: await resolveTicketSystem('ia', options),
        reason: interaction.fields.getTextInputValue(TICKET_REASON_INPUT),
      });
    } catch (error) {
      console.error('IA statement ticket create failed:', error);
      await interaction.editReply('I could not create that IA statement ticket right now.');
    }
    return;
  }

  if (interaction.customId.startsWith(`${TICKET_CREATE_MODAL_CUSTOM_PREFIX}:`)) {
    await interaction.deferReply({ ephemeral: true });
    const systemId = interaction.customId.slice(`${TICKET_CREATE_MODAL_CUSTOM_PREFIX}:`.length);
    const system = await resolveTicketSystem(systemId, options);

    if (!system) {
      await interaction.editReply('That custom ticket system no longer exists.');
      return;
    }

    try {
      await createTicketChannel(interaction, {
        system,
        reason: interaction.fields.getTextInputValue(TICKET_REASON_INPUT),
      });
    } catch (error) {
      console.error('Custom ticket create failed:', error);
      await interaction.editReply('I could not create that custom ticket right now.');
    }
    return;
  }

  if (interaction.customId === TICKET_CLOSE_MODAL) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await closeTicket(
        interaction,
        options,
        interaction.fields.getTextInputValue(TICKET_CLOSE_REASON_INPUT),
      );
    } catch (error) {
      console.error('Ticket close failed:', error);
      await interaction.editReply('I could not close that ticket right now.');
    }
  }
}

async function handleTicketThreadMessage(client, message, options = {}) {
  if (!message?.inGuild?.() || !message.channel || !message.channel.isThread() || message.author?.bot) {
    return;
  }

  const ticketInfo = getManagedTicketContext(message.channel);
  if (!ticketInfo || ticketInfo.ownerId === message.author.id) {
    return;
  }

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  const closeRoleId = String(options.supportRoleId || '').trim();
  if (!closeRoleId || !member?.roles?.cache?.has(closeRoleId)) {
    return;
  }

  const cooldownKey = `${message.channel.id}:${ticketInfo.ownerId}`;
  const lastPingAt = recentReplyPings.get(cooldownKey) || 0;
  if ((Date.now() - lastPingAt) < STAFF_REPLY_PING_COOLDOWN_MS) {
    return;
  }

  recentReplyPings.set(cooldownKey, Date.now());

  await message.channel.send({
    content: `<@${ticketInfo.ownerId}> a SAVE supervisor replied in your ticket.`,
    allowedMentions: {
      parse: [],
      users: [ticketInfo.ownerId],
      roles: [],
    },
  }).catch((error) => {
    console.error('Ticket opener ping failed:', error);
  });
}

module.exports = {
  closeManagedTicket: closeTicket,
  createCustomTicketPanelPayload,
  createTicketPanelPayload,
  createTicketSetupPayload,
  handleTicketButtonInteraction,
  handleTicketModalInteraction,
  handleTicketSelectInteraction,
  handleTicketThreadMessage,
  getManagedTicketContext,
  parseTicketTopic,
};
