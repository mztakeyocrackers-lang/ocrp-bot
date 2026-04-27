const DM_FALLBACK_CHANNEL_ID = process.env.DM_FALLBACK_CHANNEL_ID || '1465136663461105701';

async function resolveFallbackChannel(client) {
  const channel = client.channels.cache.get(DM_FALLBACK_CHANNEL_ID)
    || await client.channels.fetch(DM_FALLBACK_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

async function sendUserNotification({
  client,
  user,
  embeds,
  content,
  fallbackPrefix,
}) {
  try {
    await user.send({
      content,
      embeds,
    });

    return { deliveredVia: 'dm' };
  } catch (error) {
    const fallbackChannel = await resolveFallbackChannel(client);
    if (!fallbackChannel) {
      return { deliveredVia: 'failed', error };
    }

    const prefix = fallbackPrefix || 'DM delivery failed. Posting here instead.';

    await fallbackChannel.send({
      content: `${prefix}\n<@${user.id}>`,
      embeds,
      allowedMentions: {
        parse: [],
        users: [user.id],
        roles: [],
      },
    });

    return { deliveredVia: 'fallback', error };
  }
}

module.exports = {
  DM_FALLBACK_CHANNEL_ID,
  sendUserNotification,
};
