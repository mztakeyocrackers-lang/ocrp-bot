const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { formatQuotedMessage } = require('../lib/post-utils');
const { deletePersonnelByDiscordId } = require('../lib/tracker-log');

const TERMINATION_CHANNEL_ID = '1487911108911300838';

async function resolveTerminationChannel(interaction) {
  const channel = interaction.guild.channels.cache.get(TERMINATION_CHANNEL_ID)
    || await interaction.guild.channels.fetch(TERMINATION_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return { error: 'The termination channel is not available or is not a text channel.' };
  }

  const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe().catch(() => null));
  if (!me) {
    return { error: 'I could not verify my server permissions.' };
  }

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return { error: 'I need permission to view the termination channel.' };
  }
  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    return { error: 'I need permission to send messages in the termination channel.' };
  }
  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    return { error: 'I need permission to embed links in the termination channel.' };
  }

  return { channel };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('termination')
    .setDescription('Remove a member from the SAVE tracker and post a termination notice.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Who is being terminated?')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The termination message to post.')
        .setRequired(true),
    )
    ,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.options.getUser('member', true);
    const message = interaction.options.getString('message', true);
    const { channel, error } = await resolveTerminationChannel(interaction);
    if (error) {
      await interaction.editReply(error);
      return;
    }

    let deletedPersonnel;
    try {
      deletedPersonnel = await deletePersonnelByDiscordId(member.id);
    } catch (trackerError) {
      await interaction.editReply(trackerError.message || 'I could not remove that member from the SAVE tracker.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x992d22)
      .setTitle('Termination')
      .setDescription(
        [
          `# Termination`,
          '',
          `> **Member:** <@${member.id}>`,
          `> **Callsign:** ${deletedPersonnel?.callsign || 'Unknown'}`,
          `> **Roblox Username:** ${deletedPersonnel?.roblox_username || 'Unknown'}`,
          '',
          formatQuotedMessage(message),
        ].join('\n'),
      )
      .setFooter({ text: `Posted by ${interaction.user.tag}` })
      .setTimestamp();

    try {
      await channel.send({
        embeds: [embed],
        allowedMentions: {
          parse: [],
          users: [member.id],
          roles: [],
        },
      });
      await interaction.editReply('Termination sent and the member was removed from the SAVE tracker.');
    } catch (postError) {
      console.error('Termination post failed:', postError);
      await interaction.editReply('The member was removed from the SAVE tracker, but I could not send the termination notice.');
    }
  },
};
