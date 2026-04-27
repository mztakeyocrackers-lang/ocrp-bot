const { SlashCommandBuilder } = require('discord.js');
const {
  MAX_RESULTS,
  PROCESSING_MODES,
  SEARCH_TYPES,
  buildLookupPayload,
  buildNoResultsEmbed,
  createLookupSession,
  searchRobloxUsers,
} = require('../lib/roblox-lookup');

module.exports = {
  allowWithoutRole: true,
  data: new SlashCommandBuilder()
    .setName('rlookup')
    .setDescription('Look up Roblox users by username, display name, or user ID.')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('The username, display name, or user ID to search for.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('What type of search to perform.')
        .setRequired(false)
        .addChoices(
          { name: 'Auto-detect (default)', value: SEARCH_TYPES.AUTO },
          { name: 'Username (exact match)', value: SEARCH_TYPES.USERNAME },
          { name: 'Display Name (similar names)', value: SEARCH_TYPES.DISPLAY_NAME },
          { name: 'User ID (exact match)', value: SEARCH_TYPES.USER_ID },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('processing')
        .setDescription('Choose speed or extra polish for the lookup result.')
        .setRequired(false)
        .addChoices(
          { name: 'Quick Processing', value: PROCESSING_MODES.QUICK },
          { name: 'Slow Thoughts', value: PROCESSING_MODES.SLOW },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription(`How many results to return. Max ${MAX_RESULTS}.`)
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(MAX_RESULTS),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const type = interaction.options.getString('type') || SEARCH_TYPES.AUTO;
    const processing = interaction.options.getString('processing') || PROCESSING_MODES.QUICK;
    const limit = interaction.options.getInteger('limit') ?? 5;

    try {
      const result = await searchRobloxUsers({ query, type, limit, processingMode: processing });

      if (!result.results.length) {
        await interaction.editReply({
          embeds: [buildNoResultsEmbed(result)],
        });
        return;
      }

      const session = createLookupSession({
        ownerId: interaction.user.id,
        query: result.query,
        requestedType: result.requestedType,
        resolvedType: result.resolvedType,
        processingMode: result.processingMode,
        results: result.results,
      });

      await interaction.editReply(buildLookupPayload(session));
    } catch (error) {
      console.error('Roblox lookup command failed:', error);
      await interaction.editReply({
        content: error.message || 'Something went wrong while looking up that Roblox profile.',
      });
    }
  },
};
