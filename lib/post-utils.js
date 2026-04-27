const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

function formatQuotedMessage(message) {
  return String(message)
    .replace(/\r/g, '')
    .split('\n')
    .flatMap((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return ['> '];
      }

      const sentences = trimmedLine.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmedLine];
      return sentences.map((sentence) => `> ${sentence.trim()}`);
    })
    .join('\n');
}

async function validatePostContext(interaction, selectedRole) {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return 'I can only post in a text channel.';
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

  if (selectedRole && !selectedRole.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
    return 'I need the `Mention @everyone, @here, and All Roles` permission to ping that role.';
  }

  return null;
}

function buildDescription(title, sections) {
  const quotedSections = sections
    .filter((section) => section !== null && section !== undefined && String(section).trim() !== '')
    .map((section) => formatQuotedMessage(section))
    .join('\n');

  return `# ${title}\n\n${quotedSections}`;
}

async function sendStyledPost({
  interaction,
  title,
  color,
  selectedRole,
  description,
  sections,
  successMessage,
  footerText,
  thumbnailUrl,
}) {
  await interaction.deferReply({ ephemeral: true });

  const validationError = await validatePostContext(interaction, selectedRole);
  if (validationError) {
    await interaction.editReply(validationError);
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setDescription(description ?? buildDescription(title, sections))
      .setFooter({ text: footerText ?? `Posted by ${interaction.user.tag}` })
      .setTimestamp();

    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }

    const payload = {
      embeds: [embed],
    };

    if (selectedRole) {
      payload.content = `<@&${selectedRole.id}>`;
      payload.allowedMentions = { parse: [], roles: [selectedRole.id] };
    }

    await interaction.channel.send(payload);
    await interaction.editReply(successMessage);
  } catch (error) {
    console.error(`${title} send failed:`, error);
    await interaction.editReply('I hit an error while posting. Check that I can send messages and mention roles in this channel.');
  }
}

module.exports = {
  formatQuotedMessage,
  sendStyledPost,
};
