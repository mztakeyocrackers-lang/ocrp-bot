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
  deleteArrestRecordById,
  fetchRecentArrestRecords,
  updateArrestRecordById,
} = require('./tracker-log');

const SESSION_TTL_MS = 1000 * 60 * 30;
const PAGE_SIZE = 25;

const BUTTON_PREFIX = 'arrest_manage_btn';
const SELECT_PREFIX = 'arrest_manage_select';
const MODAL_PREFIX = 'arrest_manage_modal';

const VIEW_LIST = 'list';
const VIEW_DETAIL = 'detail';
const VIEW_DELETE = 'delete';

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

function filterArrests(session) {
  const query = normalizeKey(session.searchQuery);
  if (!query) {
    return session.arrests;
  }

  return session.arrests.filter((arrest) => [
    arrest.case_number,
    arrest.suspect_name,
    arrest.officer_name,
    arrest.charge,
    arrest.status,
    arrest.location,
  ].some((value) => normalizeKey(value).includes(query)));
}

function getSelectedArrest(session) {
  if (!session.selectedArrestId) {
    return null;
  }

  return session.arrests.find((entry) => String(entry.id) === String(session.selectedArrestId)) || null;
}

function buildListPayload(session, notice = null) {
  const filtered = filterArrests(session);
  const page = slicePage(filtered, session.page);
  session.page = page.safePage;

  const description = [
    '> Select an arrest log below to review, edit, or delete it.',
    '> Search supports case numbers, suspects, officers, charges, and status values.',
    session.searchQuery ? `> Active Search: \`${session.searchQuery}\`` : null,
    notice ? `> ${notice}` : null,
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('SAVE Arrest Manager')
    .setDescription(description)
    .setFooter({
      text: `Arrests ${filtered.length ? `${page.safePage + 1}/${page.pageCount}` : '0/0'} • Loaded: ${session.arrests.length}`,
    })
    .setTimestamp();

  if (page.items.length) {
    embed.addFields({
      name: 'Visible Arrest Logs',
      value: page.items.map((entry, index) => {
        const number = (page.safePage * PAGE_SIZE) + index + 1;
        return [
          `${number}. **${entry.case_number || 'No Case #'}**`,
          `Suspect ${truncate(entry.suspect_name, 40) || 'Unknown'}`,
          `Officer ${truncate(entry.officer_name, 40) || 'Unknown'}`,
          truncate(entry.status, 20) || 'Open',
          formatTimestamp(entry.created_at, 'R'),
        ].join(' | ');
      }).join('\n'),
    });
  } else {
    embed.addFields({
      name: 'Visible Arrest Logs',
      value: session.searchQuery
        ? 'No arrest logs matched the current search.'
        : 'No arrest logs were found to manage.',
    });
  }

  const components = [];

  if (page.items.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildSelectCustomId(session.token, 'arrest'))
          .setPlaceholder('Select an arrest log')
          .addOptions(
            page.items.map((entry, index) => {
              const number = (page.safePage * PAGE_SIZE) + index + 1;
              return {
                label: `${number}. ${truncate(entry.case_number || 'No Case #', 60)}`,
                description: truncate(`${entry.suspect_name || 'Unknown suspect'} • ${entry.officer_name || 'Unknown officer'} • ${entry.status || 'Open'}`, 100),
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
  );

  return {
    content: null,
    embeds: [embed],
    components,
  };
}

function buildDetailPayload(session, notice = null) {
  const arrest = getSelectedArrest(session);
  if (!arrest) {
    session.view = VIEW_LIST;
    return buildListPayload(session, notice || 'That arrest log is no longer available.');
  }

  const description = [
    notice ? `> ${notice}` : null,
    `> **Suspect:** ${arrest.suspect_name || 'Unknown'}`,
    `> **Officer:** ${arrest.officer_name || 'Unknown'}`,
    `> **Status:** ${arrest.status || 'Open'}`,
    `> **Location:** ${arrest.location || 'Not provided'}`,
    `> **Logged By:** ${arrest.logged_by || 'Unknown'}`,
    `> **Logged At:** ${formatTimestamp(arrest.created_at, 'F')} - ${formatTimestamp(arrest.created_at, 'R')}`,
    '',
    `> **Charge(s):** ${arrest.charge || 'None recorded.'}`,
    `> **Notes:** ${arrest.notes || 'None recorded.'}`,
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(arrest.case_number || 'Arrest Log')
    .setDescription(description)
    .setTimestamp();

  return {
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'edit'))
          .setLabel('Edit Arrest')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'delete'))
          .setLabel('Delete Arrest')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildButtonCustomId(session.token, 'back'))
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildDeletePayload(session) {
  const arrest = getSelectedArrest(session);
  if (!arrest) {
    session.view = VIEW_LIST;
    return buildListPayload(session, 'That arrest log is no longer available.');
  }

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Confirm Arrest Deletion')
    .setDescription([
      '> This will permanently delete the selected arrest log from the SAVE tracker.',
      '> This action cannot be undone from Discord once confirmed.',
      '',
      `> **Case Number:** ${arrest.case_number || 'Unknown'}`,
      `> **Suspect:** ${arrest.suspect_name || 'Unknown'}`,
      `> **Officer:** ${arrest.officer_name || 'Unknown'}`,
    ].join('\n'))
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
    case VIEW_DETAIL:
      return buildDetailPayload(session, notice);
    case VIEW_DELETE:
      return buildDeletePayload(session);
    case VIEW_LIST:
    default:
      return buildListPayload(session, notice);
  }
}

async function refreshSessionData(session) {
  const arrests = await fetchRecentArrestRecords(200);
  session.arrests = arrests;
}

async function createArrestManageSession(ownerId) {
  const session = {
    token: randomUUID(),
    ownerId,
    arrests: [],
    selectedArrestId: null,
    searchQuery: '',
    page: 0,
    view: VIEW_LIST,
    updatedAt: Date.now(),
  };

  await refreshSessionData(session);
  if (!session.arrests.length) {
    throw new Error('No arrest logs were found to manage right now.');
  }

  setSession(session);
  return session;
}

async function ensureOwnedSession(interaction, token) {
  const session = getSession(token);
  if (!session) {
    await interaction.reply({
      content: 'That arrest manager session expired. Run `/arrestmanage` again.',
      ephemeral: true,
    }).catch(() => null);
    return null;
  }

  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({
      content: 'Only the person who opened this arrest manager can use it.',
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

async function handleArrestManageButtonInteraction(interaction) {
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
        .setTitle('Search Arrest Logs');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('query')
            .setLabel('Search Query')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('Case number, suspect, officer, status...')
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
      if (session.selectedArrestId && !getSelectedArrest(session)) {
        session.selectedArrestId = null;
        session.view = VIEW_LIST;
      }
      setSession(session);
      await interaction.update(buildPayloadForView(session, 'Arrest logs refreshed.'));
      return true;
    }
    case 'back':
      session.view = VIEW_LIST;
      break;
    case 'edit': {
      const arrest = getSelectedArrest(session);
      if (!arrest) {
        session.view = VIEW_LIST;
        setSession(session);
        await interaction.update(buildListPayload(session, 'That arrest log is no longer available.'));
        return true;
      }

      const modal = new ModalBuilder()
        .setCustomId(buildModalCustomId(session.token, 'edit'))
        .setTitle('Edit Arrest Log');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('suspect_name')
            .setLabel('Suspect Name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(sanitizeText(arrest.suspect_name, 120) || 'Unknown'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('officer_name')
            .setLabel('Arresting Officer')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(sanitizeText(arrest.officer_name, 120) || 'Unknown'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('charge')
            .setLabel('Charge(s)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(sanitizeText(arrest.charge, 1000) || 'Unknown'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('status')
            .setLabel('Status')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(sanitizeText(arrest.status, 40) || 'Open'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('location')
            .setLabel('Location')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(sanitizeText(arrest.location, 240)),
        ),
      );

      await interaction.showModal(modal);
      return true;
    }
    case 'delete':
      session.view = VIEW_DELETE;
      setSession(session);
      await interaction.update(buildDeletePayload(session));
      return true;
    case 'delete_cancel':
      session.view = VIEW_DETAIL;
      setSession(session);
      await interaction.update(buildDetailPayload(session));
      return true;
    case 'delete_confirm': {
      const arrest = getSelectedArrest(session);
      if (!arrest) {
        session.view = VIEW_LIST;
        setSession(session);
        await interaction.update(buildListPayload(session, 'That arrest log was already removed.'));
        return true;
      }

      await deleteArrestRecordById(arrest.id);
      await refreshSessionData(session);
      session.selectedArrestId = null;
      session.view = VIEW_LIST;
      setSession(session);
      await interaction.update(buildListPayload(session, 'Arrest log deleted successfully.'));
      return true;
    }
    default:
      return false;
  }

  setSession(session);
  await interaction.update(buildPayloadForView(session));
  return true;
}

async function handleArrestManageSelectInteraction(interaction) {
  const parsed = parseInteractionCustomId(interaction.customId, SELECT_PREFIX);
  if (!parsed || !interaction.isStringSelectMenu()) {
    return false;
  }

  const session = await ensureOwnedSession(interaction, parsed.token);
  if (!session) {
    return true;
  }

  if (parsed.action === 'arrest') {
    session.selectedArrestId = interaction.values?.[0] || null;
    session.view = VIEW_DETAIL;
    setSession(session);
    await interaction.update(buildDetailPayload(session));
    return true;
  }

  return false;
}

async function handleArrestManageModalInteraction(interaction) {
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

  if (parsed.action === 'edit') {
    const arrest = getSelectedArrest(session);
    if (!arrest) {
      session.view = VIEW_LIST;
      setSession(session);
      await replyWithPayload(interaction, buildListPayload(session, 'That arrest log is no longer available.'));
      return true;
    }

    const updated = await updateArrestRecordById(arrest.id, {
      suspectName: interaction.fields.getTextInputValue('suspect_name'),
      officerName: interaction.fields.getTextInputValue('officer_name'),
      charge: interaction.fields.getTextInputValue('charge'),
      status: interaction.fields.getTextInputValue('status'),
      location: interaction.fields.getTextInputValue('location'),
    });

    await refreshSessionData(session);
    session.selectedArrestId = updated?.id || arrest.id;
    session.view = VIEW_DETAIL;
    setSession(session);
    await replyWithPayload(interaction, buildDetailPayload(session, 'Arrest log updated successfully.'));
    return true;
  }

  return false;
}

module.exports = {
  buildListPayload,
  createArrestManageSession,
  handleArrestManageButtonInteraction,
  handleArrestManageModalInteraction,
  handleArrestManageSelectInteraction,
};
