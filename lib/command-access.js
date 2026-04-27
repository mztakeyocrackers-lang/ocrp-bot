const DEFAULT_COMMAND_CHANNEL_ID = process.env.DEFAULT_COMMAND_CHANNEL_ID || '1465136663461105701';

const PERSONNEL_ROLE_COMMANDS = new Set([
  'patrol',
  'arrest',
  'loarequest',
  'help',
]);

const COMMAND_CHANNEL_EXEMPTIONS = new Set([
  'loarequest',
  'rolerequest',
  'noping',
  'ticketsetup',
  'ticket-add',
  'ticket-remove',
]);

function isPersonnelRoleCommand(commandName) {
  return PERSONNEL_ROLE_COMMANDS.has(String(commandName || '').trim().toLowerCase());
}

function requiresDefaultCommandChannel(commandName) {
  return !COMMAND_CHANNEL_EXEMPTIONS.has(String(commandName || '').trim().toLowerCase());
}

module.exports = {
  DEFAULT_COMMAND_CHANNEL_ID,
  COMMAND_CHANNEL_EXEMPTIONS,
  PERSONNEL_ROLE_COMMANDS,
  isPersonnelRoleCommand,
  requiresDefaultCommandChannel,
};
