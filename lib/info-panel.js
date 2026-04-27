const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const APPLICATION_URL = 'https://wjs-ocrp-isp-save-applications.vercel.app';
const DOCUMENTS_URL = 'https://save-stuff.vercel.app';
const ROLE_REQUEST_CHANNEL_ID = process.env.ROLE_REQUEST_CHANNEL_ID || '1497858144368459806';
const INFO_SELECT_ID = 'info_panel_select';
const INFO_CUSTOM_BUTTON_ID = 'info_panel_custom';
const INFO_CUSTOM_MODAL_ID = 'info_panel_custom_modal';
const INFO_PREVIEW_REFRESH_PREFIX = 'info_preview_refresh';
const INFO_PREVIEW_SEND_PREFIX = 'info_preview_send';
const INFO_PREVIEW_CANCEL_PREFIX = 'info_preview_cancel';

function formatInfoSection(title, lines) {
  const cleanLines = lines
    .filter(Boolean)
    .map((line) => `> ${String(line).trim()}`);

  return [`**${title}**`, ...cleanLines].join('\n');
}

function buildInfoEmbed({
  title,
  color,
  intro,
  sections = [],
  footerText = 'SAVE Information',
  thumbnailUrl,
}) {
  const description = [
    intro ? `> ${intro}` : null,
    ...sections.map((section) => formatInfoSection(section.title, section.lines)),
  ]
    .filter(Boolean)
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footerText })
    .setTimestamp();

  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  return embed;
}

function buildInterviewEmbeds() {
  const first = buildInfoEmbed({
    title: 'SAVE Interview Questions',
    color: 0x67d3ff,
    intro: 'Use this set to keep interviews consistent while still allowing follow-up questions.',
    sections: [
      {
        title: 'Reliability And Ownership',
        lines: [
          '`1.` Tell me about a time you made a mistake in a team setting. What happened and how did you handle it?',
          '`2.` If you knew you were going to be late to a scheduled responsibility, what would you say and who would you tell first?',
          '`3.` How do you keep yourself organized when you have logs, deadlines, or responsibilities to remember?',
          '`4.` What is one weakness you are actively trying to improve right now, and what are you doing about it?',
          '`5.` Why do you want SAVE specifically, and why do you think you would fit it well?',
        ],
      },
      {
        title: 'Integrity And Judgment',
        lines: [
          '`6.` If a friend asked you to bend a rule because it was "not a big deal," how would you respond?',
          '`7.` What would you do if another member asked you to change a log or record to make them look better?',
          '`8.` If you were told to halt duties during an investigation, what would that mean in practice?',
          '`9.` What is the difference between being strict and being fair?',
          '`10.` How would you explain the no-copy-paste rule to an applicant who was nervous or confused?',
        ],
      },
    ],
    footerText: 'SAVE Interview Panel',
  });

  const second = buildInfoEmbed({
    title: 'SAVE Interview Questions Continued',
    color: 0xf1c878,
    sections: [
      {
        title: 'Communication And Team Fit',
        lines: [
          '`11.` If you disagreed with a supervisor instruction, how would you handle it without making the situation worse?',
          '`12.` What does professional communication sound like from you? Give an example line you would actually say.',
          '`13.` If you saw another member making a situation more heated instead of calmer, what would you do?',
          '`14.` Tell me about a time you had to learn a new system, rule set, or process quickly. How did you do it?',
          '`15.` If I asked people what you are like to work with, what would they say?',
        ],
      },
      {
        title: 'Useful Follow-Ups',
        lines: [
          'Ask for a real example when an answer sounds scripted.',
          'Ask what they would actually say in that moment.',
          'Ask how they personally keep track of responsibilities.',
          'Ask what part of the job would be hardest for them at first.',
        ],
      },
    ],
    footerText: 'SAVE Interview Panel',
  });

  return {
    embeds: [first, second],
  };
}

function getInfoTemplatePayload(key) {
  switch (key) {
    case 'save_overview':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'Statewide Anti-Violence Enforcement',
            color: 0xf1c878,
            intro: 'SAVE is a statewide Illinois State Police violent-crime reduction program staffed by selected ISP personnel.',
            sections: [
              {
                title: 'Mission',
                lines: [
                  'Target violent offenders, illegal firearms, stolen vehicles, and narcotics activity.',
                  'Support local problem areas through proactive enforcement and visible presence.',
                ],
              },
              {
                title: 'Structure',
                lines: [
                  'SAVE is built from ISP troopers, supervisors, and specialized support when needed.',
                  'It is an assigned program, not a separate outside department.',
                ],
              },
              {
                title: 'Coverage',
                lines: [
                  'Common focus areas include Chicago, Metro East, and major interstate corridors.',
                  'SAVE can deploy anywhere in Illinois when operational needs require it.',
                ],
              },
            ],
          }),
        ],
      };
    case 'applications_process':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Application Process',
            color: 0xf1c878,
            intro: 'Applications are the first stage of selection, not an automatic acceptance.',
            sections: [
              {
                title: 'Review Stage',
                lines: [
                  'Staff review professionalism, judgment, effort, and overall fit after submission.',
                  'Applications can be denied during review before any interview is offered.',
                ],
              },
              {
                title: 'Advancement',
                lines: [
                  'Qualified applicants move to a structured interview if they pass review.',
                  'A ride-along is required before assignment consideration within SAVE.',
                ],
              },
              {
                title: 'Selection Standard',
                lines: [
                  'Meeting the minimum stage requirements does not guarantee acceptance.',
                  'Unit needs, readiness, reliability, and disciplinary standing all matter.',
                ],
              },
            ],
          }),
        ],
      };
    case 'verification':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Verification',
            color: 0x67d3ff,
            intro: 'Verification links your Roblox identity to Discord access inside the SAVE server.',
            sections: [
              {
                title: 'What It Does',
                lines: [
                  'Applies the verified role and syncs your nickname to your linked Roblox account.',
                  'Supports controlled access to SAVE tools, logs, and internal systems.',
                ],
              },
              {
                title: 'Expectation',
                lines: [
                  'Use `/verify` and finish the Roblox link before trying to use SAVE systems.',
                  'Keep your linked account accurate and avoid sharing identities across members.',
                ],
              },
            ],
          }),
        ],
      };
    case 'shift_logs':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Patrol Logging',
            color: 0x57f287,
            intro: 'Patrol logs track activity time, quota progress, and proof-backed work.',
            sections: [
              {
                title: 'Accepted Paths',
                lines: [
                  'Patrols can be logged through the website or through `/patrol` in Discord.',
                  'Both paths feed the same tracker and patrol review flow.',
                ],
              },
              {
                title: 'Logging Standard',
                lines: [
                  'Start time, end time, proof, and notes should match the actual patrol.',
                  'Logs should be complete enough to review without extra guesswork.',
                ],
              },
              {
                title: 'Quota Impact',
                lines: [
                  'Tracked patrol time is what command uses for quota and activity review.',
                ],
              },
            ],
          }),
        ],
      };
    case 'patrol_proof':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'Patrol Proof Standard',
            color: 0x57f287,
            intro: 'Every patrol log should be backed by proof that is clear and reachable.',
            sections: [
              {
                title: 'Required Proof',
                lines: [
                  'Use a Discord message link or other approved proof that clearly shows the patrol occurred.',
                  'Proof should stay available long enough for command review when needed.',
                ],
              },
              {
                title: 'Bad Proof',
                lines: [
                  'Broken links, vague screenshots, or unrelated evidence can lead to a correction or rejection.',
                ],
              },
            ],
          }),
        ],
      };
    case 'arrest_logs':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Arrest Logging',
            color: 0xed4245,
            intro: 'Arrest logs are part of the official tracker record and should be treated that way.',
            sections: [
              {
                title: 'Accepted Paths',
                lines: [
                  'Arrests can be logged through the website or through `/arrest` in Discord.',
                  'Both paths send the same record into the tracker and arrest-log channel.',
                ],
              },
              {
                title: 'Logging Standard',
                lines: [
                  'Charges, names, times, and narrative details should be accurate and complete.',
                  'Logs should read clearly enough for later review without follow-up questions.',
                ],
              },
            ],
          }),
        ],
      };
    case 'deployments':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Deployment Guidelines',
            color: 0x2b2d31,
            intro: 'Deployments are active operational notices, not general chatter or casual status posts.',
            sections: [
              {
                title: 'Deployment Standard',
                lines: [
                  'Use deployment notices when a deployment is actively in progress and SAVE is operating together.',
                  'Independent patrol outside an active deployment is not authorized under a deployment notice.',
                ],
              },
              {
                title: 'Equipment And Vehicles',
                lines: [
                  'SAVE equipment and vehicles are tied to deployment use and professional conduct.',
                  'Equipment misuse or use outside deployment standards reflects directly on the unit.',
                ],
              },
            ],
          }),
        ],
      };
    case 'operations':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Operations',
            color: 0x2b2d31,
            intro: 'Operations are longer-planned events that require structured command oversight.',
            sections: [
              {
                title: 'Planning Standard',
                lines: [
                  'Operations should include watch, supervisors, code officer, briefing time, and vehicle usage.',
                  'The post should be complete enough for personnel to understand structure and expectations.',
                ],
              },
              {
                title: 'Coordination',
                lines: [
                  'If outside units or departments are involved, state who is involved and why.',
                  'Operational planning should make command relationships clear before the event starts.',
                ],
              },
            ],
          }),
        ],
      };
    case 'breaching_guide':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'Simple Breaching Guide',
            color: 0xed4245,
            intro: 'All SAVE personnel are expected to know and recognize these simple breach readiness signals.',
            sections: [
              {
                title: 'Preparation',
                lines: [
                  'These callouts happen after personnel are stacked and ready at the point of breach.',
                  'Weapons should already be up and members should already know their role before the signals start.',
                ],
              },
              {
                title: 'Readiness Calls',
                lines: [
                  '`.` means the member is ready.',
                  '`?` means the member is checking whether the rest of the stack is ready.',
                  '`!` is the breach call.',
                ],
              },
              {
                title: 'Expectation',
                lines: [
                  'Keep the callouts short, clear, and timed correctly.',
                  'Everyone on SAVE is expected to understand this without it slowing down the breach.',
                ],
              },
            ],
            footerText: 'SAVE Breaching Guide',
          }),
        ],
      };
    case 'documents':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Documents',
            color: 0x67d3ff,
            intro: 'The documents site is the main hub for written SAVE reference material.',
            sections: [
              {
                title: 'Includes',
                lines: [
                  'SOP, internal reference pages, and other written SAVE materials.',
                  'Use it when you need document-based guidance instead of a quick announcement post.',
                ],
              },
            ],
            footerText: 'SAVE Documents',
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('Open Documents Website')
              .setStyle(ButtonStyle.Link)
              .setURL(DOCUMENTS_URL),
          ),
        ],
      };
    case 'application_portal':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Applications',
            color: 0xf1c878,
            intro: 'The official application portal is where written applications are completed.',
            sections: [
              {
                title: 'Portal Use',
                lines: [
                  'Use the official portal for the written application and secure assessment flow.',
                  'Take time with your responses and answer honestly in your own words.',
                ],
              },
              {
                title: 'Selection Reminder',
                lines: [
                  'Submission moves you into review; it does not guarantee acceptance into SAVE.',
                ],
              },
            ],
            footerText: 'SAVE Applications',
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('Open Application Portal')
              .setStyle(ButtonStyle.Link)
              .setURL(APPLICATION_URL),
          ),
        ],
      };
    case 'role_requests':
      return {
        embeds: [
          buildInfoEmbed({
            title: 'SAVE Role Requests',
            color: 0x5865f2,
            intro: 'Role requests should be used when you need command review for additional SAVE access or responsibility.',
            sections: [
              {
                title: 'Where To Use It',
                lines: [
                  `Use \`/rolerequest\` in <#${ROLE_REQUEST_CHANNEL_ID}>.`,
                  'The command opens a private panel first, then you submit the request from there.',
                ],
              },
              {
                title: 'What To Include',
                lines: [
                  'State the exact role you are requesting.',
                  'Explain why you need it and what it would be used for.',
                  'Include relevant experience, qualifications, or context that helps command review it quickly.',
                ],
              },
              {
                title: 'Review Expectation',
                lines: [
                  'Requests should be clear, honest, and specific enough to review without guesswork.',
                  'Submitting a request sends it for command review; it does not guarantee approval.',
                ],
              },
            ],
            footerText: 'SAVE Role Requests',
          }),
        ],
      };
    case 'interview_questions':
      return buildInterviewEmbeds();
    default:
      return null;
  }
}

const INFO_OPTIONS = [
  { label: 'SAVE Overview', value: 'save_overview', description: 'Post the SAVE program overview.' },
  { label: 'Applications Process', value: 'applications_process', description: 'Post the review, interview, and ride-along process.' },
  { label: 'Verification', value: 'verification', description: 'Post the Roblox verification overview.' },
  { label: 'Patrol Logging', value: 'shift_logs', description: 'Post patrol logging information.' },
  { label: 'Patrol Proof', value: 'patrol_proof', description: 'Post the patrol proof standard.' },
  { label: 'Arrest Logging', value: 'arrest_logs', description: 'Post arrest logging information.' },
  { label: 'Deployments', value: 'deployments', description: 'Post deployment guidance.' },
  { label: 'Operations', value: 'operations', description: 'Post operations guidance.' },
  { label: 'Breaching Guide', value: 'breaching_guide', description: 'Post the simple breaching guide.' },
  { label: 'Documents', value: 'documents', description: 'Post the documents hub embed.' },
  { label: 'Application Portal', value: 'application_portal', description: 'Post the applications embed with the portal button.' },
  { label: 'Role Requests', value: 'role_requests', description: 'Post the role request information embed.' },
  { label: 'Interview Questions', value: 'interview_questions', description: 'Post the interview question set.' },
];

function getInfoOption(key) {
  return INFO_OPTIONS.find((entry) => entry.value === key) || null;
}

function createInfoPreviewPayload(key, statusText = null) {
  const payload = getInfoTemplatePayload(key);
  const option = getInfoOption(key);

  if (!payload || !option) {
    return createInfoPanelPayload('That information option is no longer available.');
  }

  const controlsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${INFO_PREVIEW_REFRESH_PREFIX}:${key}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${INFO_PREVIEW_CANCEL_PREFIX}:${key}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${INFO_PREVIEW_SEND_PREFIX}:${key}`)
      .setLabel('Send')
      .setStyle(ButtonStyle.Success),
  );

  return {
    content: statusText
      ? `Previewing **${option.label}**\n> ${statusText}`
      : `Previewing **${option.label}**\n> This is a private preview. Use **Send** to post it in the channel.`,
    embeds: payload.embeds || [],
    components: [...(payload.components || []), controlsRow],
  };
}

function createInfoPanelPayload(statusText = null) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('SAVE Information Panel')
    .setDescription([
      '> Choose an information set to post in this channel.',
      '> Deleted information posts were folded into this panel so the content stays in one place.',
      '> Use the custom option if you want to build a one-off information embed.',
      statusText ? '' : null,
      statusText ? `**Status**\n> ${statusText}` : null,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'SAVE Assistant Information Panel' })
    .setTimestamp();

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(INFO_SELECT_ID)
      .setPlaceholder('Select an information set to post...')
      .addOptions(INFO_OPTIONS),
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(INFO_CUSTOM_BUTTON_ID)
      .setLabel('Create Custom Info Embed')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [selectRow, buttonRow],
  };
}

async function validateInfoChannel(interaction) {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return 'I can only post information panels in a text channel.';
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

async function postInfoTemplate(interaction, key, successMessage = null) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const validationError = await validateInfoChannel(interaction);
  if (validationError) {
    await interaction.editReply(validationError);
    return;
  }

  const payload = getInfoTemplatePayload(key);
  const option = INFO_OPTIONS.find((entry) => entry.value === key);

  if (!payload) {
    await interaction.editReply('That information template no longer exists.');
    return;
  }

  await interaction.channel.send(payload);
  await interaction.editReply(successMessage || `${option?.label || 'Information panel'} sent.`);
}

async function handleInfoSelectInteraction(interaction) {
  if (interaction.customId !== INFO_SELECT_ID) {
    return false;
  }

  const key = interaction.values?.[0];
  const option = getInfoOption(key);
  const payload = getInfoTemplatePayload(key);

  if (!option || !payload) {
    await interaction.update(createInfoPanelPayload('That information option is no longer available.'));
    return true;
  }

  const validationError = await validateInfoChannel(interaction);
  if (validationError) {
    await interaction.update(createInfoPanelPayload(validationError));
    return true;
  }

  await interaction.update(createInfoPreviewPayload(key));
  return true;
}

function createCustomInfoModal() {
  const modal = new ModalBuilder()
    .setCustomId(INFO_CUSTOM_MODAL_ID)
    .setTitle('Create Custom Info Embed');

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Header / Title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(120);

  const authorInput = new TextInputBuilder()
    .setCustomId('author')
    .setLabel('Author')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const summaryInput = new TextInputBuilder()
    .setCustomId('summary')
    .setLabel('Summary Line')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300);

  const detailsInput = new TextInputBuilder()
    .setCustomId('details')
    .setLabel('Details / Points')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder('One point per line');

  const footerInput = new TextInputBuilder()
    .setCustomId('footer')
    .setLabel('Footer')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100)
    .setPlaceholder('Defaults to SAVE Information');

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(authorInput),
    new ActionRowBuilder().addComponents(summaryInput),
    new ActionRowBuilder().addComponents(detailsInput),
    new ActionRowBuilder().addComponents(footerInput),
  );

  return modal;
}

async function handleInfoButtonInteraction(interaction) {
  if (interaction.customId === INFO_CUSTOM_BUTTON_ID) {
    await interaction.showModal(createCustomInfoModal());
    return true;
  }

  if (interaction.customId?.startsWith(`${INFO_PREVIEW_REFRESH_PREFIX}:`)) {
    const key = interaction.customId.slice(`${INFO_PREVIEW_REFRESH_PREFIX}:`.length);
    const validationError = await validateInfoChannel(interaction);
    if (validationError) {
      await interaction.update(createInfoPanelPayload(validationError));
      return true;
    }

    await interaction.update(createInfoPreviewPayload(key, 'Preview refreshed.'));
    return true;
  }

  if (interaction.customId?.startsWith(`${INFO_PREVIEW_SEND_PREFIX}:`)) {
    const key = interaction.customId.slice(`${INFO_PREVIEW_SEND_PREFIX}:`.length);
    const validationError = await validateInfoChannel(interaction);
    if (validationError) {
      await interaction.update(createInfoPanelPayload(validationError));
      return true;
    }

    const payload = getInfoTemplatePayload(key);
    const option = getInfoOption(key);
    if (!payload || !option) {
      await interaction.update(createInfoPanelPayload('That information option is no longer available.'));
      return true;
    }

    await interaction.channel.send(payload);
    await interaction.update(createInfoPreviewPayload(key, `${option.label} sent.`));
    return true;
  }

  if (interaction.customId?.startsWith(`${INFO_PREVIEW_CANCEL_PREFIX}:`)) {
    await interaction.update({
      content: null,
      embeds: [
        new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle('SAVE Information Panel')
          .setDescription('> Information preview closed.')
          .setFooter({ text: 'SAVE Assistant Information Panel' })
          .setTimestamp(),
      ],
      components: [],
    });
    return true;
  }

  return false;
}

async function handleInfoModalInteraction(interaction) {
  if (interaction.customId !== INFO_CUSTOM_MODAL_ID) {
    return false;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const validationError = await validateInfoChannel(interaction);
  if (validationError) {
    await interaction.editReply(validationError);
    return true;
  }

  const title = interaction.fields.getTextInputValue('title');
  const author = interaction.fields.getTextInputValue('author').trim();
  const summary = interaction.fields.getTextInputValue('summary').trim();
  const details = interaction.fields.getTextInputValue('details').trim();
  const footer = interaction.fields.getTextInputValue('footer').trim();

  const detailLines = details
    ? details
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join('\n')
    : '';

  const embed = new EmbedBuilder()
    .setColor(0x99aab5)
    .setTitle(title)
    .setDescription([
      `> ${summary}`,
      detailLines ? '' : null,
      detailLines || null,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: footer || 'SAVE Information' })
    .setTimestamp();

  if (author) {
    embed.setAuthor({ name: author });
  }

  await interaction.channel.send({ embeds: [embed] });
  await interaction.editReply('Custom information embed sent.');
  return true;
}

module.exports = {
  createInfoPanelPayload,
  handleInfoButtonInteraction,
  handleInfoModalInteraction,
  handleInfoSelectInteraction,
  postInfoTemplate,
};
