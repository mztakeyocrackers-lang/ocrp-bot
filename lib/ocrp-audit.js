const { insertRows } = require('./ocrp-db');

function sanitizeSummary(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function recordAuditEvent({
  guildId = null,
  actorDiscordId = null,
  actorTag = null,
  action,
  targetType,
  targetId = null,
  summary,
  metadata = {},
}) {
  if (!action || !targetType || !summary) {
    return null;
  }

  const rows = await insertRows('audit_events', {
    guild_id: guildId,
    actor_discord_id: actorDiscordId,
    actor_tag: actorTag,
    action,
    target_type: targetType,
    target_id: targetId,
    summary: sanitizeSummary(summary),
    metadata,
  });

  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

module.exports = {
  recordAuditEvent,
};
