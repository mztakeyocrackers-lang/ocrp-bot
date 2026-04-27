const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const LOA_ALERT_ROLE_ID = process.env.LOA_ALERT_ROLE_ID || '1465136661187924105';
const LOA_REQUEST_CHANNEL_ID = process.env.LOA_REQUEST_CHANNEL_ID || '1465136666523209752';
const CHANNEL_LOCK_EXEMPT_ROLE_ID = process.env.REQUIRED_COMMAND_ROLE_ID || '1465136661187924105';

async function validateChannel(interaction, member) {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return 'I can only post LOA requests in a text channel.';
  }

  const isChannelLockExempt = Boolean(member?.roles?.cache?.has(CHANNEL_LOCK_EXEMPT_ROLE_ID));

  if (!isChannelLockExempt && interaction.channelId !== LOA_REQUEST_CHANNEL_ID) {
    return `You can only use \`/loarequest\` in <#${LOA_REQUEST_CHANNEL_ID}>.`;
  }

  const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe().catch(() => null));

  if (!me) {
    return 'I could not verify my server permissions.';
  }

  const permissions = interaction.channel.permissionsFor(me);

  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return 'I need permission to view this channel.';
  }

  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    return 'I need permission to send messages in this channel.';
  }

  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    return 'I need permission to embed links in this channel.';
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loarequest')
    .setDescription('Submit an LOA request for staff review.')
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Requested LOA length, like 7d, 12h, 3d 6h, or 90m.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Why you are requesting LOA.')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const member =
      interaction.member ??
      (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

    const validationError = await validateChannel(interaction, member);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    const duration = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason', true);

    const embed = new EmbedBuilder()
      .setColor(0xf1c878)
      .setTitle('LOA Request')
      .setDescription(
        [
          'A personnel member has submitted an LOA request.',
          '',
          `**Member:** <@${interaction.user.id}>`,
          `**Requested Duration:** ${duration}`,
          `**Reason:** ${reason}`,
        ].join('\n'),
      )
      .setFooter({ text: 'SAVE Assistant LOA Requests' })
      .setTimestamp();

    await interaction.channel.send({
      content: `<@&${LOA_ALERT_ROLE_ID}>`,
      embeds: [embed],
      allowedMentions: {
        parse: [],
        roles: [LOA_ALERT_ROLE_ID],
        users: [interaction.user.id],
      },
    });

    await interaction.editReply('Your LOA request was sent for staff review.');
  },
};
