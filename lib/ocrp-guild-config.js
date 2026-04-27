const {
  insertRows,
  selectRows,
  selectSingleRow,
  upsertRows,
} = require('./ocrp-db');

const guildConfigCache = new Map();
const guildConfigCacheTime = new Map();
const CONFIG_CACHE_TTL_MS = Math.max(5000, Number(process.env.OCRP_CONFIG_CACHE_TTL_MS || 30000));

const MODULE_DEFINITIONS = {
  patrol: {
    channelField: 'patrol_log_channel_id',
    label: 'Patrol',
  },
  arrest: {
    channelField: 'arrest_log_channel_id',
    label: 'Arrest',
  },
  promotion: {
    channelField: 'promotion_log_channel_id',
    label: 'Promotion',
  },
  demotion: {
    channelField: 'demotion_log_channel_id',
    label: 'Demotion',
  },
  blacklist: {
    channelField: 'blacklist_log_channel_id',
    label: 'Blacklist',
  },
};

const DEFAULT_COMMAND_ROLE_MAP = Object.freeze({
  patrol: [],
  arrest: [],
  promotion: [],
  demotion: [],
  blacklist: [],
});

const DEFAULT_FEATURE_TOGGLES = Object.freeze({
  patrol: true,
  arrest: true,
  promotion: true,
  demotion: true,
  blacklist: true,
});

const DEFAULT_DEPARTMENT_LABELS = Object.freeze({
  patrol: 'Patrol Command',
  arrest: 'Records Division',
  promotion: 'Personnel Command',
  demotion: 'Personnel Command',
  blacklist: 'Command Review',
});

function stringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean)));
}

function normalizeCommandRoleMap(input = {}) {
  const output = { ...DEFAULT_COMMAND_ROLE_MAP };
  for (const key of Object.keys(DEFAULT_COMMAND_ROLE_MAP)) {
    output[key] = stringArray(input?.[key]);
  }
  return output;
}

function normalizeFeatureToggles(input = {}) {
  const output = { ...DEFAULT_FEATURE_TOGGLES };
  for (const key of Object.keys(DEFAULT_FEATURE_TOGGLES)) {
    if (typeof input?.[key] === 'boolean') {
      output[key] = input[key];
    }
  }
  return output;
}

function normalizeDepartmentLabels(input = {}) {
  const output = { ...DEFAULT_DEPARTMENT_LABELS };
  for (const key of Object.keys(DEFAULT_DEPARTMENT_LABELS)) {
    const value = String(input?.[key] || '').trim();
    if (value) {
      output[key] = value;
    }
  }
  return output;
}

function normalizeMirrorChannelMap(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    const normalized = String(value || '').trim();
    if (normalized) {
      output[key] = normalized;
    }
  }
  return output;
}

function normalizeConfigRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    guild_id: String(row.guild_id),
    patrol_log_channel_id: String(row.patrol_log_channel_id || ''),
    arrest_log_channel_id: String(row.arrest_log_channel_id || ''),
    promotion_log_channel_id: String(row.promotion_log_channel_id || ''),
    demotion_log_channel_id: String(row.demotion_log_channel_id || ''),
    blacklist_log_channel_id: String(row.blacklist_log_channel_id || ''),
    dashboard_notice_channel_id: String(row.dashboard_notice_channel_id || ''),
    setup_completed: Boolean(row.setup_completed),
    command_role_map: normalizeCommandRoleMap(row.command_role_map),
    feature_toggles: normalizeFeatureToggles(row.feature_toggles),
    department_labels: normalizeDepartmentLabels(row.department_labels),
    mirror_channel_map: normalizeMirrorChannelMap(row.mirror_channel_map),
  };
}

function buildConfigPayload(guildId, partial = {}) {
  const existing = guildConfigCache.get(String(guildId));
  const mergedCommandRoles = normalizeCommandRoleMap({
    ...(existing?.command_role_map || DEFAULT_COMMAND_ROLE_MAP),
    ...(partial.command_role_map || {}),
  });
  const mergedFeatures = normalizeFeatureToggles({
    ...(existing?.feature_toggles || DEFAULT_FEATURE_TOGGLES),
    ...(partial.feature_toggles || {}),
  });
  const mergedDepartments = normalizeDepartmentLabels({
    ...(existing?.department_labels || DEFAULT_DEPARTMENT_LABELS),
    ...(partial.department_labels || {}),
  });
  const mergedMirrorMap = normalizeMirrorChannelMap({
    ...(existing?.mirror_channel_map || {}),
    ...(partial.mirror_channel_map || {}),
  });

  return {
    guild_id: String(guildId),
    patrol_log_channel_id: String(partial.patrol_log_channel_id ?? existing?.patrol_log_channel_id ?? ''),
    arrest_log_channel_id: String(partial.arrest_log_channel_id ?? existing?.arrest_log_channel_id ?? ''),
    promotion_log_channel_id: String(partial.promotion_log_channel_id ?? existing?.promotion_log_channel_id ?? ''),
    demotion_log_channel_id: String(partial.demotion_log_channel_id ?? existing?.demotion_log_channel_id ?? ''),
    blacklist_log_channel_id: String(partial.blacklist_log_channel_id ?? existing?.blacklist_log_channel_id ?? ''),
    dashboard_notice_channel_id: String(partial.dashboard_notice_channel_id ?? existing?.dashboard_notice_channel_id ?? ''),
    command_role_map: mergedCommandRoles,
    feature_toggles: mergedFeatures,
    department_labels: mergedDepartments,
    mirror_channel_map: mergedMirrorMap,
    setup_completed: typeof partial.setup_completed === 'boolean'
      ? partial.setup_completed
      : Boolean(existing?.setup_completed),
    setup_notes: String(partial.setup_notes ?? existing?.setup_notes ?? '').trim(),
  };
}

async function ensureGuildConfigRow(guildId) {
  const existing = await selectSingleRow('guild_configs', {
    select: '*',
    guild_id: `eq.${guildId}`,
  });

  if (existing) {
    const normalized = normalizeConfigRow(existing);
    guildConfigCache.set(String(guildId), normalized);
    return normalized;
  }

  const inserted = await insertRows('guild_configs', buildConfigPayload(guildId, {}));
  const normalized = normalizeConfigRow(Array.isArray(inserted) ? inserted[0] : inserted);
  guildConfigCache.set(String(guildId), normalized);
  return normalized;
}

async function loadGuildConfigCache() {
  const rows = await selectRows('guild_configs', { select: '*' }).catch(() => []);
  guildConfigCache.clear();
  guildConfigCacheTime.clear();

  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeConfigRow(row);
    guildConfigCache.set(normalized.guild_id, normalized);
    guildConfigCacheTime.set(normalized.guild_id, Date.now());
  }

  return guildConfigCache;
}

async function getGuildConfig(guildId) {
  const key = String(guildId);
  const cachedAt = guildConfigCacheTime.get(key) || 0;
  if (guildConfigCache.has(key) && (Date.now() - cachedAt) < CONFIG_CACHE_TTL_MS) {
    return guildConfigCache.get(key);
  }

  const fresh = await selectSingleRow('guild_configs', {
    select: '*',
    guild_id: `eq.${key}`,
  }).catch(() => null);

  if (!fresh) {
    return ensureGuildConfigRow(key);
  }

  const normalized = normalizeConfigRow(fresh);
  guildConfigCache.set(key, normalized);
  guildConfigCacheTime.set(key, Date.now());
  return normalized;
}

async function saveGuildConfig(guildId, partial = {}) {
  const payload = buildConfigPayload(guildId, partial);
  const rows = await upsertRows('guild_configs', payload, { onConflict: 'guild_id' });
  const normalized = normalizeConfigRow(Array.isArray(rows) ? rows[0] : rows);
  guildConfigCache.set(String(guildId), normalized);
  guildConfigCacheTime.set(String(guildId), Date.now());
  return normalized;
}

async function syncGuildFromDiscord(guild) {
  await upsertRows('guilds', {
    guild_id: guild.id,
    guild_name: guild.name,
    icon_url: guild.iconURL({ size: 256 }) || null,
    owner_id: guild.ownerId || null,
    member_count: guild.memberCount || 0,
    bot_joined_at: new Date().toISOString(),
    active: true,
    onboarded: true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'guild_id' });

  await ensureGuildConfigRow(guild.id);
}

async function syncAllGuildsFromClient(client) {
  for (const guild of client.guilds.cache.values()) {
    await syncGuildFromDiscord(guild);
  }
}

async function markGuildInactive(guild) {
  await upsertRows('guilds', {
    guild_id: guild.id,
    guild_name: guild.name,
    icon_url: guild.iconURL({ size: 256 }) || null,
    owner_id: guild.ownerId || null,
    member_count: guild.memberCount || 0,
    active: false,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'guild_id' });
}

function buildGuildHealthReport(guild, config) {
  const missing = [];

  for (const [moduleKey, moduleConfig] of Object.entries(MODULE_DEFINITIONS)) {
    if (config.feature_toggles[moduleKey] === false) {
      continue;
    }

    const channelId = config[moduleConfig.channelField];
    if (!channelId) {
      missing.push(`${moduleConfig.label} log channel`);
    } else if (!guild.channels.cache.has(channelId)) {
      missing.push(`${moduleConfig.label} log channel missing from guild`);
    }

    if (!config.command_role_map[moduleKey]?.length) {
      missing.push(`${moduleConfig.label} command roles`);
    }
  }

  return {
    guildId: guild.id,
    guildName: guild.name,
    setupCompleted: config.setup_completed,
    missing,
    healthy: config.setup_completed && missing.length === 0,
  };
}

async function validateConfiguredGuilds(client) {
  const results = [];

  for (const guild of client.guilds.cache.values()) {
    const config = await getGuildConfig(guild.id);
    results.push(buildGuildHealthReport(guild, config));
  }

  return results;
}

module.exports = {
  DEFAULT_COMMAND_ROLE_MAP,
  DEFAULT_DEPARTMENT_LABELS,
  DEFAULT_FEATURE_TOGGLES,
  MODULE_DEFINITIONS,
  getGuildConfig,
  guildConfigCache,
  loadGuildConfigCache,
  markGuildInactive,
  saveGuildConfig,
  syncAllGuildsFromClient,
  syncGuildFromDiscord,
  validateConfiguredGuilds,
};
