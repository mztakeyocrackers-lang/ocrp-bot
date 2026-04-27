const os = require('node:os');
const { upsertRows } = require('./ocrp-db');

const HEARTBEAT_INTERVAL_MS = Math.max(15000, Number(process.env.OCRP_HEARTBEAT_INTERVAL_MS || 60000));

async function reportRuntimeHeartbeat(client, overrides = {}) {
  if (!client?.user) {
    return null;
  }

  const payload = {
    instance_id: process.env.OCRP_BOT_INSTANCE_ID || os.hostname(),
    bot_user_id: client.user.id,
    bot_tag: client.user.tag,
    status: overrides.status || 'online',
    host: os.hostname(),
    version: process.env.OCRP_BOT_VERSION || 'v1',
    guild_count: client.guilds.cache.size,
    latency_ms: Number.isFinite(client.ws.ping) ? client.ws.ping : null,
    metadata: {
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      ...overrides.metadata,
    },
    last_heartbeat_at: new Date().toISOString(),
  };

  const rows = await upsertRows('bot_runtime_status', payload, { onConflict: 'instance_id' });
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function startRuntimeHeartbeat(client) {
  const interval = setInterval(() => {
    reportRuntimeHeartbeat(client).catch((error) => {
      console.error('Failed to send OCRP runtime heartbeat:', error);
    });
  }, HEARTBEAT_INTERVAL_MS);

  return { interval };
}

function stopRuntimeHeartbeat(controller) {
  if (controller?.interval) {
    clearInterval(controller.interval);
  }
}

module.exports = {
  reportRuntimeHeartbeat,
  startRuntimeHeartbeat,
  stopRuntimeHeartbeat,
};
