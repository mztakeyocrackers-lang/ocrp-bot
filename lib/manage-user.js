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
  createPersonnelRecord,
  deletePersonnelByDiscordId,
  fetchPersonnelRecords,
  updatePersonnelRecordById,
} = require('./tracker-log');
const { applyLoaState } = require('./loa-utils');
const { applyPromotionCooldownState, getPromotionCooldownEntry } = require('./promotion-cooldown-utils');

const SESSION_TTL_MS = 1000 * 60 * 30;
const PAGE_SIZE = 25;

const BUTTON_PREFIX = 'manage_user_btn';
const SELECT_PREFIX = 'manage_user_select';
const MODAL_PREFIX = 'manage_user_modal';

const VIEW_LIST = 'list';
const VIEW_DETAIL = 'detail';
const VIEW_REMOVE = 'remove';

const sessions = new Map();

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

function buildButtonCustomId(token, action) {
  return `${BUTTON_PREFIX}:${token}:${action}`;
}

function buildSelectCustomId(token, action) {
  return `${SELECT_PREFIX}:${token}:${action}`;
}

function buildModalCustomId(token, action) {
  return `${MODAL_PREFIX}:${token}:${action}`;
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

function filterPersonnel(session) {
  const query = normalizeKey(session.searchQuery);
  if (!query) {
    return session.users;
  }

  return session.users.filter((entry) => [
    entry.callsign,
    entry.rank,
    entry.roblox_username,
    entry.discord,
    entry.discord_id,
    entry.status,
    entry.category,
  ].some((value) => normalizeKey(value).includes(query)));
}

function getSelectedUser(session) {
  if (!session.selectedUserId) {
    return null;
  }

  return session.users.find((entry) => String(entry.id) === String(session.selectedUserId)) || null;
}

function normalizeCategoryInput(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'general';
  }

  if (!['general', 'senior', 'supervisory'].includes(normalized)) {
    throw new Error('Category must be general, senior, or supervisory.');
  }

  return normalized;
}

function buildListPayload(session, notice = null) {
  const filtered = filterPersonnel(session);
  const page = slicePage(filtered, session.page);
  session.page = page.safePage;

  const description = [
    '> Select a roster member below to manage their SAVE tracker record.',
    '> Search supports callsigns, ranks, Roblox usernames, Discord names, category, and status.',
    session.searchQuery ? `> Active Search: \`${session.searchQuery}\`` : null,
    notice ? `> ${notice}` : null,
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x4a9fd4)
    .setTitle('SAVE User Manager')
    .setDescription(description)
    .setFooter({
      text: `Users ${filtered.length ? `${page.safePage + 1}/${page.pageCount}` : '0/0'} • Loaded: ${session.users.length}`,
    })
    .setTimestamp();

  if (page.items.length) {
    embed.addFields({
      name: 'Visible Roster Members',
      value: page.items.map((entry, index) => {
        const number = (page.safePage * PAGE_SIZE) + index + 1;
        return [
          `${number}. **${entry.callsign || 'No Callsign'}**`,
          truncate(entry.rank, 30) || 'Unknown rank',
          truncate(entry.roblox_username, 30) || 'Unknown username',
          truncate(entry.status, 20) || 'Active',
          truncate(entry.category, 20) || 'general',
        ].join(' | ');
      }).join('\n'),
    });
  } else {
    embed.addFields({
      name: 'Visible Roster Members',
      value: session.searchQuery
        ? 'No roster members matched the current search.'
        : 'No roster records were found to manage.',
    });
  }

  const components = [];

  if (page.items.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildSelectCustomId(session.token, 'user'))
          .setPlaceholder('Select a roster member')
          .addOptions(
            page.items.map((entry, index) => {
              const number = (page.safePage * PAGE_SIZE) + index + 1;
              return {
                label: `${number}. ${truncate(entry.callsign || 'No Callsign', 60)}`,
                description: truncate(`${entry.roblox_username || 'Unknown'} • ${entry.rank || 'Unknown rank'} • ${entry.status || 'Active'}`, 100),
                value: String(entry.id),
              };
            }),
          ),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'prev'))
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.safePage <= 0),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'next'))
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.safePage >= page.pageCount - 1),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'search'))
        .setLabel('Search')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'clear'))
        .setLabel('Clear Search')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!session.searchQuery),
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'refresh'))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildButtonCustomId(session.token, 'add'))
        .setLabel('Add To Roster')
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return {
    content: null,
    embeds: [embed],
    components,
  };
}

function buildDetailPayload(session, notice = null) {
  const record = getSelectedUser(session);
  if (!record) {
    session.view = VIEW_LIST;
    return buildListPayload(session, notice || 'That roster record is no longer available.');
  }

  const cooldownEntry = record.discord_id ? getPromotionCooldownEntry(record.discord_id) : null;
  const description = [
    notice ? `> ${notice}` : null,
    `> **Callsign:** ${record.callsign || 'Unknown'}`,
    `> **Rank:** ${record.rank || 'Unknown'}`,
    `> **Roblox Username:** ${record.roblox_username || 'Unknown'}`,
    `> **Roblox ID:** ${record.roblox_id || 'Not linked'}`,
    `> **Discord:** ${record.discord || 'Unknown'}`,
    `> **Discord ID:** ${record.discord_id || 'Not linked'}`,
    `> **Category:** ${record.category || 'general'}`,
    `> **Status:** ${record.status || 'Active'}`,
    cooldownEntry
      ? `> **Promotion Cooldown:** Active until ${formatTimestamp(cooldownEntry.expiresAtMs, 'F')} (${formatTimestamp(cooldownEntry.expiresAtMs, 'R')})`
      : '> **Promotion Cooldown:** Inactive',
    `> **Joined:** ${record.join_date ? formatTimestamp(record.join_date, 'D') : 'Unknown'}`,
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x4a9fd4)
    .setTitle(`Manage User - ${record.callsign || record.roblox_username || 'Roster Record'}`)
    .setDescription(description)
    .setTimestamp();

  return {
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'promote'))
          .setLabel('Promote')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'demote'))
          .setLabel('Demote')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'cooldown'))
          .setLabel('Promotion Cooldown')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'loa'))
          .setLabel('Toggle LOA')
          .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'remove'))
          .setLabel('Remove')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'back'))
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildRemovePayload(session) {
  const record = getSelectedUser(session);
  if (!record) {
    session.view = VIEW_LIST;
    return buildListPayload(session, 'That roster record is no longer available.');
  }

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Confirm Roster Removal')
    .setDescription([
      '> This will remove the selected user from the SAVE tracker roster.',
      '> This does not remove their Discord roles automatically.',
      '',
      `> **Callsign:** ${record.callsign || 'Unknown'}`,
      `> **Rank:** ${record.rank || 'Unknown'}`,
      `> **Roblox Username:** ${record.roblox_username || 'Unknown'}`,
      `> **Discord ID:** ${record.discord_id || 'Not linked'}`,
    ].join('\n'))
    .setTimestamp();

  return {
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'remove_confirm'))
          .setLabel('Confirm Remove')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'remove_cancel'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildPayloadForView(session, notice = null) {
  switch (session.view) {
    case VIEW_DETAIL:
      return buildDetailPayload(session, notice);
    case VIEW_REMOVE:
      return buildRemovePayload(session);
    case VIEW_LIST:
    default:
      return buildListPayload(session, notice);
  }
}

async function refreshSessionData(session) {
  session.users = await fetchPersonnelRecords(500);
}

async function createManageUserSession(ownerId) {
  const session = {
    token: randomUUID(),
    ownerId,
    users: [],
    selectedUserId: null,
    searchQuery: '',
    page: 0,
    view: VIEW_LIST,
    updatedAt: Date.now(),
  };

  await refreshSessionData(session);
  if (!session.users.length) {
    throw new Error('No roster records were found to manage right now.');
  }

  setSession(session);
  return session;
}

async function ensureOwnedSession(interaction, token) {
  const session = getSession(token);
  if (!session) {
    await interaction.reply({
      content: 'That user manager session expired. Run `/manageuser` again.',
      ephemeral: true,
    }).catch(() => null);
    return null;
  }

  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({
      content: 'Only the person who opened this user manager can use it.',
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

async function openPromoteDemoteModal(interaction, session, action) {
  const record = getSelectedUser(session);
  if (!record) {
    session.view = VIEW_LIST;
    setSession(session);
    await interaction.update(buildListPayload(session, 'That roster record is no longer available.'));
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(buildModalCustomId(session.token, action))
    .setTitle(action === 'promote' ? 'Promotion Update' : 'Demotion Update');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('callsign')
        .setLabel('Callsign')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(sanitizeText(record.callsign, 40) || 'Unknown'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rank')
        .setLabel('Rank')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(sanitizeText(record.rank, 80) || 'Unknown'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('category')
        .setLabel('Category (general, senior, supervisory)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(sanitizeText(record.category, 30) || 'general'),
    ),
  );

  await interaction.showModal(modal);
  return true;
}

async function handleManageUserButtonInteraction(interaction) {
  const parsed = parseInteractionCustomId(interaction.customId, BUTTON_PREFIX);
  if (!parsed || !interaction.isButton()) {
    return false;
  }

  const session = await ensureOwnedSession(interaction, parsed.token);
  if (!session) {
    return true;
  }

  switch (parsed.action) {
    case 'prev':
      session.page = Math.max(0, session.page - 1);
      session.view = VIEW_LIST;
      break;
    case 'next':
      session.page += 1;
      session.view = VIEW_LIST;
      break;
    case 'search': {
      const modal = new ModalBuilder()
        .setCustomId(buildModalCustomId(session.token, 'search'))
        .setTitle('Search Roster');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('query')
            .setLabel('Search Query')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('Callsign, rank, username, Discord name...')
            .setValue(session.searchQuery || ''),
        ),
      );

      await interaction.showModal(modal);
      return true;
    }
    case 'clear':
      session.searchQuery = '';
      session.page = 0;
      session.view = VIEW_LIST;
      break;
    case 'refresh': {
      await refreshSessionData(session);
      if (session.selectedUserId && !getSelectedUser(session)) {
        session.selectedUserId = null;
        session.view = VIEW_LIST;
      }

      setSession(session);
      await interaction.update(buildPayloadForView(session, 'Roster refreshed.'));
      return true;
    }
    case 'add': {
      const modal = new ModalBuilder()
        .setCustomId(buildModalCustomId(session.token, 'add'))
        .setTitle('Add To Roster');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('discord_id')
            .setLabel('Discord User ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Paste the member Discord ID'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('callsign')
            .setLabel('Callsign')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('rank')
            .setLabel('Rank')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('roblox_username')
            .setLabel('Roblox Username')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('category')
            .setLabel('Category (general, senior, supervisory)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue('general'),
        ),
      );

      await interaction.showModal(modal);
      return true;
    }
    case 'back':
      session.view = VIEW_LIST;
      break;
    case 'promote':
      return openPromoteDemoteModal(interaction, session, 'promote');
    case 'demote':
      return openPromoteDemoteModal(interaction, session, 'demote');
    case 'cooldown': {
      const record = getSelectedUser(session);
      if (!record) {
        session.view = VIEW_LIST;
        setSession(session);
        await interaction.update(buildListPayload(session, 'That roster record is no longer available.'));
        return true;
      }

      const modal = new ModalBuilder()
        .setCustomId(buildModalCustomId(session.token, 'cooldown'))
        .setTitle('Promotion Cooldown');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Reason for starting, updating, or ending the cooldown'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('minutes')
            .setLabel('Minutes (blank clears an active cooldown)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('60, 1440, or 10080'),
        ),
      );

      await interaction.showModal(modal);
      return true;
    }
    case 'loa': {
      const record = getSelectedUser(session);
      if (!record) {
        session.view = VIEW_LIST;
        setSession(session);
        await interaction.update(buildListPayload(session, 'That roster record is no longer available.'));
        return true;
      }

      const modal = new ModalBuilder()
        .setCustomId(buildModalCustomId(session.token, 'loa'))
        .setTitle('LOA Update');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Reason for starting or ending LOA'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('duration')
            .setLabel('Duration (required when starting)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('7d, 12h, 3d 6h, or leave blank to end'),
        ),
      );

      await interaction.showModal(modal);
      return true;
    }
    case 'remove':
      session.view = VIEW_REMOVE;
      setSession(session);
      await interaction.update(buildRemovePayload(session));
      return true;
    case 'remove_cancel':
      session.view = VIEW_DETAIL;
      setSession(session);
      await interaction.update(buildDetailPayload(session));
      return true;
    case 'remove_confirm': {
      const record = getSelectedUser(session);
      if (!record) {
        session.view = VIEW_LIST;
        setSession(session);
        await interaction.update(buildListPayload(session, 'That roster record was already removed.'));
        return true;
      }

      if (!record.discord_id) {
        throw new Error('That roster record does not have a linked Discord ID to remove.');
      }

      await deletePersonnelByDiscordId(record.discord_id);
      await refreshSessionData(session);
      session.selectedUserId = null;
      session.view = VIEW_LIST;
      setSession(session);
      await interaction.update(buildListPayload(session, 'Roster record removed successfully.'));
      return true;
    }
    default:
      return false;
  }

  setSession(session);
  await interaction.update(buildPayloadForView(session));
  return true;
}

async function handleManageUserSelectInteraction(interaction) {
  const parsed = parseInteractionCustomId(interaction.customId, SELECT_PREFIX);
  if (!parsed || !interaction.isStringSelectMenu()) {
    return false;
  }

  const session = await ensureOwnedSession(interaction, parsed.token);
  if (!session) {
    return true;
  }

  if (parsed.action === 'user') {
    session.selectedUserId = interaction.values?.[0] || null;
    session.view = VIEW_DETAIL;
    setSession(session);
    await interaction.update(buildDetailPayload(session));
    return true;
  }

  return false;
}

async function handleManageUserModalInteraction(interaction) {
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
    session.page = 0;
    session.view = VIEW_LIST;
    setSession(session);
    await replyWithPayload(
      interaction,
      buildListPayload(session, session.searchQuery ? 'Search applied.' : 'Search cleared.'),
    );
    return true;
  }

  if (parsed.action === 'add') {
    const discordId = sanitizeText(interaction.fields.getTextInputValue('discord_id'), 40);
    const member = await interaction.guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      throw new Error('I could not find that Discord member in this server.');
    }

    const created = await createPersonnelRecord({
      callsign: interaction.fields.getTextInputValue('callsign'),
      rank: interaction.fields.getTextInputValue('rank'),
      robloxUsername: interaction.fields.getTextInputValue('roblox_username'),
      robloxId: '',
      discordName: member.user.username,
      discordId: member.id,
      category: normalizeCategoryInput(interaction.fields.getTextInputValue('category')),
      status: 'Active',
      joinDate: new Date().toISOString().slice(0, 10),
    });

    await refreshSessionData(session);
    session.selectedUserId = created?.id || null;
    session.view = created?.id ? VIEW_DETAIL : VIEW_LIST;
    setSession(session);
    await replyWithPayload(interaction, buildPayloadForView(session, `Added <@${member.id}> to the SAVE tracker.`));
    return true;
  }

  if (parsed.action === 'promote' || parsed.action === 'demote') {
    const record = getSelectedUser(session);
    if (!record) {
      session.view = VIEW_LIST;
      setSession(session);
      await replyWithPayload(interaction, buildListPayload(session, 'That roster record is no longer available.'));
      return true;
    }

    const updated = await updatePersonnelRecordById(record.id, {
      callsign: interaction.fields.getTextInputValue('callsign'),
      rank: interaction.fields.getTextInputValue('rank'),
      category: normalizeCategoryInput(interaction.fields.getTextInputValue('category')),
    });

    await refreshSessionData(session);
    session.selectedUserId = updated?.id || record.id;
    session.view = VIEW_DETAIL;
    setSession(session);
    await replyWithPayload(
      interaction,
      buildDetailPayload(session, parsed.action === 'promote' ? 'Roster promotion update saved.' : 'Roster demotion update saved.'),
    );
    return true;
  }

  if (parsed.action === 'loa') {
    const record = getSelectedUser(session);
    if (!record) {
      session.view = VIEW_LIST;
      setSession(session);
      await replyWithPayload(interaction, buildListPayload(session, 'That roster record is no longer available.'));
      return true;
    }

    if (!record.discord_id) {
      throw new Error('That roster record does not have a linked Discord ID for LOA updates.');
    }

    const member = await interaction.guild.members.fetch(record.discord_id).catch(() => null);
    if (!member) {
      throw new Error('I could not find that Discord member in this server for the LOA update.');
    }

    const reason = interaction.fields.getTextInputValue('reason');
    const durationInput = interaction.fields.getTextInputValue('duration') || '';
    const result = await applyLoaState({
      interaction,
      member,
      reason,
      durationInput,
    });

    await refreshSessionData(session);
    session.selectedUserId = record.id;
    session.view = VIEW_DETAIL;
    setSession(session);
    await replyWithPayload(
      interaction,
      buildDetailPayload(
        session,
        result.actionLabel === 'started'
          ? 'LOA started and logged successfully.'
          : 'LOA ended and logged successfully.',
      ),
    );
    return true;
  }

  if (parsed.action === 'cooldown') {
    const record = getSelectedUser(session);
    if (!record) {
      session.view = VIEW_LIST;
      setSession(session);
      await replyWithPayload(interaction, buildListPayload(session, 'That roster record is no longer available.'));
      return true;
    }

    if (!record.discord_id) {
      throw new Error('That roster record does not have a linked Discord ID for promotion cooldown updates.');
    }

    const member = await interaction.guild.members.fetch(record.discord_id).catch(() => null);
    if (!member) {
      throw new Error('I could not find that Discord member in this server for the promotion cooldown update.');
    }

    const reason = interaction.fields.getTextInputValue('reason');
    const minutesInput = interaction.fields.getTextInputValue('minutes') || '';
    const result = await applyPromotionCooldownState({
      interaction,
      member,
      reason,
      minutesInput,
    });

    session.selectedUserId = record.id;
    session.view = VIEW_DETAIL;
    setSession(session);
    await replyWithPayload(
      interaction,
      buildDetailPayload(
        session,
        result.actionLabel === 'started'
          ? 'Promotion cooldown started successfully.'
          : result.actionLabel === 'updated'
            ? 'Promotion cooldown updated successfully.'
            : 'Promotion cooldown ended successfully.',
      ),
    );
    return true;
  }

  return false;
}

module.exports = {
  buildListPayload,
  createManageUserSession,
  handleManageUserButtonInteraction,
  handleManageUserModalInteraction,
  handleManageUserSelectInteraction,
};
