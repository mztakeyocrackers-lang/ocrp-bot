const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, MODULE_DEFINITIONS } = require('./ocrp-guild-config');

async function assertGuildModuleAccess(interaction, moduleKey) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
    throw new Error('This OCRP command can only be used inside a configured OCRP server.');
  }

  const moduleDefinition = MODULE_DEFINITIONS[moduleKey];
  if (!moduleDefinition) {
    throw new Error(`Unknown OCRP module "${moduleKey}".`);
  }

  const config = await getGuildConfig(interaction.guildId);
  if (!config?.setup_completed) {
    throw new Error('This guild has not been fully configured in the OCRP dashboard yet.');
  }

  if (config.feature_toggles[moduleKey] === false) {
    throw new Error(`The ${moduleDefinition.label.toLowerCase()} module is disabled for this guild.`);
  }

  const logChannelId = config[moduleDefinition.channelField];
  if (!logChannelId) {
    throw new Error(`No ${moduleDefinition.label.toLowerCase()} log channel is configured in the OCRP dashboard.`);
  }

  const allowedRoles = config.command_role_map[moduleKey] || [];
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  if (!isAdmin) {
    if (!allowedRoles.length) {
      throw new Error(`No OCRP command roles are configured for ${moduleDefinition.label.toLowerCase()} actions yet.`);
    }

    const memberRoleIds = interaction.member.roles?.cache?.map((role) => role.id) || [];
    const hasMappedRole = memberRoleIds.some((roleId) => allowedRoles.includes(roleId));

    if (!hasMappedRole) {
      throw new Error(`You do not have access to use the ${moduleDefinition.label.toLowerCase()} command in this guild.`);
    }
  }

  return {
    config,
    logChannelId,
    moduleDefinition,
  };
}

module.exports = {
  assertGuildModuleAccess,
};
