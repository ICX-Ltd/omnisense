// Synthetic LivePerson export used by the importer tests.
//
// The header list is the real one from a production export (conversationId
// first, transcriptAll/Agent/Consumer last), so the tests exercise a genuine
// ~330-column row rather than a toy shape. Rows are built programmatically
// because hand-maintaining 330 tab-separated columns is not viable.
//
// Every row here reproduces a specific failure mode the real file will contain.
// Delete one only when the corresponding code path is gone.

const CUSTOMER_INFO_SUFFIXES = [
  'customerStatus',
  'customerType',
  'balance',
  'customerId',
  'socialId',
  'imei',
  'userName',
  'accountName',
  'role',
  'lastPaymentDate-year',
  'lastPaymentDate-month',
  'lastPaymentDate-day',
  'registrationDate-year',
  'registrationDate-month',
  'registrationDate-day',
  'companySize',
  'storeZipCode',
  'storeNumber',
  'loginStatus',
  'companyBranch',
];

/** The real LivePerson tabular-export header, in order. */
export const LIVEPERSON_HEADERS: string[] = [
  'conversationId',
  'brandId',
  'startTimeL',
  'startTime',
  'startTimeUTC',
  'startTimeLOCAL',
  'startTimeDate',
  'startTimeYear',
  'startTimeMonth',
  'startTimeMonthStr',
  'startTimeDay',
  'startTimeWeekday',
  'startTimeWeekdayStr',
  'startTimeTimestamp',
  'startTimeHour',
  'startTimeMinute',
  'startTimeWeekSun',
  'startTimeWeekMon',
  'endTimeL',
  'endTime',
  'endTimeUTC',
  'endTimeLOCAL',
  'endTimeDate',
  'endTimeYear',
  'endTimeMonth',
  'endTimeMonthStr',
  'endTimeDay',
  'endTimeWeekday',
  'endTimeWeekdayStr',
  'endTimeTimestamp',
  'endTimeHour',
  'endTimeMinute',
  'endTimeWeekSun',
  'endTimeWeekMon',
  'duration',
  'summaryText',
  'summaryTimeUTC',
  'closeReason',
  'closeReasonDescription',
  'device',
  'source',
  'browser',
  'operatingSystem',
  'status',
  'firstConversation',
  'interactive',
  'isPartial',
  'latestAgentFullName',
  'latestAgentGroupId',
  'latestAgentGroupName',
  'latestAgentId',
  'latestAgentLoginName',
  'latestAgentNickname',
  'latestQueueState',
  'latestSkillId',
  'latestSkillName',
  'userType',
  'userTypeName',
  'agentDeleted',
  'campaignEngagementId',
  'campaignEngagementName',
  'campaignId',
  'campaignName',
  'goalId',
  'goalName',
  'engagementAgentNote',
  'engagementSource',
  'visitorBehaviorId',
  'visitorBehaviorName',
  'visitorProfileId',
  'visitorProfileName',
  'lobId',
  'lobName',
  'LocationId',
  'LocationName',
  'behaviorSystemDefault',
  'profileSystemDefault',
  'engagementApplicationId',
  'engagementApplicationName',
  'engagementApplicationTypeId',
  'engagementApplicationTypeName',
  'agentParticipantsCount',
  'agentParticipantsTimeUTC',
  'agentParticipantsTimeL',
  'agentParticipantsId',
  'agentParticipantsFullName',
  'agentParticipantsLoginName',
  'agentParticipantsNickname',
  'agentParticipantsDeleted',
  'agentParticipantsPid',
  'agentParticipantsUserType',
  'agentParticipantsUserTypeName',
  'agentParticipantsRole',
  'agentParticipantsGroupName',
  'agentParticipantsGroupId',
  'agentParticipantsPermission',
  'consumerParticipantsCount',
  'consumerParticipantsTimeUTC',
  'consumerParticipantsTimeL',
  'consumerParticipantsId',
  'consumerParticipantsEmail',
  'consumerParticipantsFirstName',
  'consumerParticipantsLastName',
  'consumerParticipantsPhone',
  'consumerParticipantsToken',
  'consumerParticipantsConsumerName',
  'transfersCount',
  'transfersTimeUTC',
  'transfersTimeL',
  'transfersBy',
  'transfersReason',
  'transfersAssignedAgentId',
  'transfersSourceAgentId',
  'transfersSourceAgentFullName',
  'transfersSourceAgentLoginName',
  'transfersSourceAgentNickName',
  'transfersSourceSkillId',
  'transfersSourceSkillName',
  'transfersTargetSkillId',
  'transfersTargetSkillName',
  'interactionsAgentCount',
  'interactionsAgentTimeUTC',
  'interactionsAgentTimeL',
  'interactionsAgentId',
  'interactionsAgentFullName',
  'interactionsAgentNickname',
  'interactionsAgentLoginName',
  'interactionsAgentInteractiveSequence',
  'csatRate',
  'csatCount',
  'mcs',
  'alertedMCS',
  'mcsTrend',
  'mcsMin',
  'mcsMax',
  'mcsStandard',
  'mcsDescription',
  'mcsGroup',
  'mcsRank',
  'mcsCount',
  'messageCount',
  'messageTime',
  'responseTime',
  'responseTimeAssignment',
  'responseCount',
  'messageCountAgent',
  'messageCountAgentHuman',
  'messageCountAgentSystem',
  'messageCountAgentBot',
  'messageCountConsumer',
  'messageTimeAgent',
  'messageTimeAgentHuman',
  'messageTimeAgentSystem',
  'messageTimeAgentBot',
  'messageTimeConsumer',
  'averageMessageTime',
  'averageMessageTimeAgent',
  'averageMessageTimeAgentHuman',
  'averageMessageTimeAgentSystem',
  'averageMessageTimeAgentBot',
  'averageMessageTimeConsumer',
  'responseCountAgent',
  'responseCountAgentHuman',
  'responseCountAgentSystem',
  'responseCountAgentBot',
  'responseCountConsumer',
  'responseTimeAgent',
  'responseTimeAgentHuman',
  'responseTimeAgentSystem',
  'responseTimeAgentBot',
  'responseTimeAssignmentAgent',
  'responseTimeAssignmentAgentHuman',
  'responseTimeAssignmentAgentSystem',
  'responseTimeAssignmentAgentBot',
  'responseTimeConsumer',
  'responseTimeAssignmentConsumer',
  'averageResponseTime',
  'averageResponseTimeAssignment',
  'averageResponseTimeAgent',
  'averageResponseTimeAgentHuman',
  'averageResponseTimeAgentSystem',
  'averageResponseTimeAgentBot',
  'averageResponseTimeAssignmentAgent',
  'averageResponseTimeAssignmentAgentHuman',
  'averageResponseTimeAssignmentAgentSystem',
  'averageResponseTimeAssignmentAgentBot',
  'averageResponseTimeConsumer',
  'averageResponseTimeAssignmentConsumer',
  'firstRespondent',
  'firstResponseTimeAgentFromConsumer',
  'firstResponseTimeAgentHumanFromConsumer',
  'firstResponseTimeAgentSystemFromConsumer',
  'firstResponseTimeAgentBotFromConsumer',
  'firstResponseTimeConsumerFromAgent',
  'firstResponseTimeAgentFromAssignment',
  'firstResponseTimeAgentHumanFromAssignment',
  'firstResponseTimeAgentSystemFromAssignment',
  'firstResponseTimeAgentBotFromAssignment',
  'firstResponseTimeAgentFromAssignmentCount',
  'firstResponseTimeAgentHumanFromAssignmentCount',
  'firstResponseTimeAgentSystemFromAssignmentCount',
  'firstResponseTimeAgentBotFromAssignmentCount',
  'averageFirstResponseTimeAgentFromAssignment',
  'averageFirstResponseTimeAgentHumanFromAssignment',
  'averageFirstResponseTimeAgentSystemFromAssignment',
  'averageFirstResponseTimeAgentBotFromAssignment',
  'firstResponseTimeAgentFromFirstAssignment',
  'firstResponseTimeAgentHumanFromFirstAssignment',
  'firstResponseTimeAgentSystemFromFirstAssignment',
  'firstResponseTimeAgentBotFromFirstAssignment',
  'firstAssignmentTimeAgentFromStart',
  'firstAssignmentTimeAgentHumanFromStart',
  'firstAssignmentTimeAgentSystemFromStart',
  'firstAssignmentTimeAgentBotFromStart',
  'words',
  'wordsAgent',
  'wordsAgentHuman',
  'wordsAgentSystem',
  'wordsAgentBot',
  'wordsConsumer',
  'questions',
  'questionsAgent',
  'questionsAgentHuman',
  'questionsAgentSystem',
  'questionsAgentBot',
  'questionsConsumer',
  'surveyType',
  'surveyStatus',
  'surveyQuestion',
  'surveyAnswer',
  'coBrowseCount',
  'coBrowseSessionId',
  'coBrowseStartTime',
  'coBrowseStartTimeL',
  'coBrowseEndTime',
  'coBrowseEndTimeL',
  'coBrowseEndReason',
  'coBrowseDuration',
  'coBrowseType',
  'coBrowseAgentId',
  'coBrowseInteractive',
  ...CUSTOMER_INFO_SUFFIXES.map((s) => `customerInfo-${s}`),
  ...CUSTOMER_INFO_SUFFIXES.map((s) => `unauthcustomerInfo-${s}`),
  'personalInfo-name',
  'personalInfo-surname',
  'personalInfo-gender',
  'personalInfo-company',
  'personalInfo-customerAge',
  'personalInfo-email',
  'personalInfo-phone',
  'personalInfo-language',
  'sdes',
  'configuredResponseTime',
  'latestEffectiveResponseDueTime',
  'monitoring-country',
  'monitoring-countryCode',
  'monitoring-state',
  'monitoring-city',
  'monitoring-isp',
  'monitoring-org',
  'monitoring-device',
  'monitoring-ipAddress',
  'monitoring-browser',
  'monitoring-operatingSystem',
  'monitoring-conversationStartPage',
  'monitoring-conversationStartPageTitle',
  'operatingSystemVersion',
  'browserVersion',
  'integration',
  'integrationVersion',
  'appId',
  'appVersion',
  'isTruncated',
  'ipAddress',
  'language',
  'sessionId',
  'interactionContextId',
  'timeZone',
  'surveyTypePostSurvey',
  'surveyStatusPostSurvey',
  'surveyIdPostSurvey',
  'surveyDialogIdPostSurvey',
  'surveyQuestionPostSurvey',
  'surveyAnswerPostSurvey',
  'surveyQuestionIdPostSurvey',
  'surveyAnswerIdPostSurvey',
  'surveyQuestionTypePostSurvey',
  'surveyQuestionFormatPostSurvey',
  'transcriptAll',
  'transcriptAgent',
  'transcriptConsumer',
];

export type FixtureRow = Record<string, string>;

/** Baseline values shared by every fixture row. */
function baseRow(): FixtureRow {
  return {
    brandId: '81234567',
    startTimeLOCAL: '19/02/2025 09:15:00',
    startTimeUTC: '2025-02-19T09:15:00Z',
    startTimeDate: '19/02/2025',
    endTimeUTC: '2025-02-19T09:20:00Z',
    duration: '300',
    closeReason: 'AGENT',
    closeReasonDescription: 'Resolved by agent',
    status: 'CLOSE',
    isPartial: 'false',
    isTruncated: 'false',
    latestAgentFullName: 'Jane Smith',
    latestAgentNickname: 'Jane',
    latestAgentLoginName: 'jsmith',
    latestAgentGroupName: 'RAC Breakdown Team',
    latestSkillName: 'RAC Breakdown',
    campaignName: 'RAC Breakdown New Business',
    lobName: 'Breakdown',
    LocationName: 'Bristol',
    messageCount: '4',
    messageCountAgent: '2',
    messageCountConsumer: '2',
    csatRate: '',
    csatCount: '0',
    mcs: '60',
    alertedMCS: 'false',
    'monitoring-country': 'United Kingdom',
    'monitoring-city': 'Bristol',
    summaryText: 'Customer reported a breakdown; recovery arranged.',
    summaryTimeUTC: '2025-02-19T09:20:30Z',
  };
}

const SIMPLE_TRANSCRIPT = [
  '09:15:02 - Consumer: my car has broken down',
  '09:15:30 - Agent: sorry to hear that, where are you?',
  '09:16:10 - Consumer: junction 14 of the M1',
  '09:16:45 - Agent: recovery is on its way',
].join('\n');

/** Each entry documents the failure mode it exists to reproduce. */
export const FIXTURE_ROWS: Array<{ note: string; row: FixtureRow }> = [
  {
    note: 'clean baseline row — must stage as valid with no issues',
    row: { ...baseRow(), conversationId: 'conv-0001', transcriptAll: SIMPLE_TRANSCRIPT },
  },
  {
    note: 'transcript containing commas, tabs, CRLF and doubled quotes inside a quoted field',
    row: {
      ...baseRow(),
      conversationId: 'conv-0002',
      transcriptAll: [
        '09:15:02 - Consumer: hi, my car, which is a 2019 Golf, won\'t start',
        '09:15:30 - Agent: no problem\tlet me help',
        '09:16:00 - Consumer: he said "it is the battery", so I waited',
        '09:16:30 - Agent: understood — arranging recovery now',
      ].join('\r\n'),
    },
  },
  {
    note: 'conversation crossing midnight — day offset must increment, gaps must stay positive',
    row: {
      ...baseRow(),
      conversationId: 'conv-0003',
      startTimeLOCAL: '19/02/2025 23:55:00',
      transcriptAll: [
        '23:56:00 - Consumer: still waiting for recovery',
        '23:59:30 - Agent: the driver is 10 minutes away',
        '00:01:15 - Consumer: ok thanks',
        '00:02:00 - Agent: apologies for the wait',
      ].join('\n'),
    },
  },
  {
    note: 'multi-day conversation — two rollovers',
    row: {
      ...baseRow(),
      conversationId: 'conv-0004',
      startTimeLOCAL: '19/02/2025 22:00:00',
      transcriptAll: [
        '22:00:00 - Consumer: day one',
        '01:00:00 - Agent: day two',
        '23:30:00 - Consumer: still day two',
        '02:00:00 - Agent: day three',
      ].join('\n'),
    },
  },
  {
    note: 'Excel serial start time — produced when the export is opened and re-saved',
    row: {
      ...baseRow(),
      conversationId: 'conv-0005',
      startTimeLOCAL: '45707.385416',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'over-length campaignName — must truncate to 50 with the original preserved',
    row: {
      ...baseRow(),
      conversationId: 'conv-0006',
      campaignName:
        'RAC Breakdown Cover New Business Acquisition Campaign Q1 2025 Digital Chat',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'duplicate conversationId — the earlier row wins, this one is flagged',
    row: { ...baseRow(), conversationId: 'conv-0001', transcriptAll: SIMPLE_TRANSCRIPT },
  },
  {
    note: 'empty transcriptAll but both side columns populated — must merge by clock',
    row: {
      ...baseRow(),
      conversationId: 'conv-0007',
      transcriptAll: '',
      transcriptAgent: [
        '09:15:30 - Agent: sorry to hear that',
        '09:16:45 - Agent: recovery is on its way',
      ].join('\n'),
      transcriptConsumer: [
        '09:15:02 - Consumer: my car has broken down',
        '09:16:10 - Consumer: junction 14 of the M1',
      ].join('\n'),
    },
  },
  {
    note: 'answered CSAT survey with a low score and a free-text comment',
    row: {
      ...baseRow(),
      conversationId: 'conv-0008',
      csatRate: '2',
      csatCount: '1',
      mcs: '25',
      alertedMCS: 'true',
      surveyTypePostSurvey: 'PostChat',
      surveyStatusPostSurvey: 'FILLED',
      surveyQuestionPostSurvey: 'How satisfied were you?;Would you recommend us?',
      surveyAnswerPostSurvey: 'Waited far too long for recovery;No',
      surveyQuestionIdPostSurvey: 'q1;q2',
      surveyAnswerIdPostSurvey: 'a1;a2',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'speaker label is the agent real name — must classify as Agent, not Unknown',
    row: {
      ...baseRow(),
      conversationId: 'conv-0009',
      transcriptAll: [
        '09:15:02 - Consumer: hello',
        '09:15:30 - Jane Smith: hi, how can I help?',
        '09:16:00 - Consumer: breakdown on the M4',
      ].join('\n'),
    },
  },
  {
    note: 'System and Bot labels plus the handover marker',
    row: {
      ...baseRow(),
      conversationId: 'conv-0010',
      transcriptAll: [
        '09:15:00 - System: chat started',
        '09:15:05 - Bot: how can I help today?',
        '09:15:20 - Consumer: I have broken down',
        '09:15:25 - Agent: You are now connected to Jane',
        '09:15:40 - Agent: hello, let me take a look',
      ].join('\n'),
    },
  },
  {
    note: 'unrecognised speaker label — staged but excluded from the promoted transcript',
    row: {
      ...baseRow(),
      conversationId: 'conv-0011',
      transcriptAll: [
        '09:15:02 - Consumer: hello',
        '09:15:10 - Supervisor Bob: stepping in to assist',
        '09:15:30 - Agent: hi there',
      ].join('\n'),
    },
  },
  {
    note: 'conversation id longer than interactionId varchar(50) — must be E_KEY_TOO_LONG',
    row: {
      ...baseRow(),
      conversationId: 'conv-' + 'x'.repeat(60),
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'blank conversation id — must be E_NO_KEY',
    row: { ...baseRow(), conversationId: '', transcriptAll: SIMPLE_TRANSCRIPT },
  },
  {
    note: 'unparseable start time — must be E_NO_DATE',
    row: {
      ...baseRow(),
      conversationId: 'conv-0012',
      startTimeLOCAL: 'not a date',
      startTimeUTC: '',
      startTimeDate: '',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'no transcript at all — must be E_NO_TRANSCRIPT (transcripts.text is NOT NULL)',
    row: { ...baseRow(), conversationId: 'conv-0013', transcriptAll: '' },
  },
  {
    note: 'transcript prose with no timestamps — must be E_TRANSCRIPT_UNPARSED',
    row: {
      ...baseRow(),
      conversationId: 'conv-0014',
      transcriptAll: 'Customer called about a breakdown. Recovery was arranged.',
    },
  },
  {
    note: 'source flags the conversation partial and truncated',
    row: {
      ...baseRow(),
      conversationId: 'conv-0015',
      isPartial: 'true',
      isTruncated: 'true',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'campaign with no "RAC" — must warn, since the RAC QA assessment would be skipped',
    row: {
      ...baseRow(),
      conversationId: 'conv-0016',
      campaignName: 'Generic Breakdown Enquiry',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'no agent name, and csatCount positive with no rate',
    row: {
      ...baseRow(),
      conversationId: 'conv-0017',
      latestAgentFullName: '',
      latestAgentNickname: '',
      latestAgentLoginName: '',
      csatRate: '',
      csatCount: '1',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
  {
    note: 'consumer PII populated — must never reach rawJson',
    row: {
      ...baseRow(),
      conversationId: 'conv-0018',
      consumerParticipantsEmail: 'alex.jones@example.com',
      consumerParticipantsFirstName: 'Alex',
      consumerParticipantsLastName: 'Jones',
      consumerParticipantsPhone: '07700900123',
      consumerParticipantsConsumerName: 'Alex Jones',
      'personalInfo-name': 'Alex',
      'personalInfo-surname': 'Jones',
      'personalInfo-email': 'alex.jones@example.com',
      'personalInfo-phone': '07700900123',
      'customerInfo-customerId': 'CUST-556677',
      'customerInfo-userName': 'alexj99',
      'unauthcustomerInfo-imei': '490154203237518',
      ipAddress: '203.0.113.42',
      'monitoring-ipAddress': '203.0.113.42',
      transcriptAll: SIMPLE_TRANSCRIPT,
    },
  },
];

const TAB = '\t';

/** RFC4180-quotes a value for a delimited file. */
function quote(value: string, delimiter: string): string {
  if (
    value.includes('"') ||
    value.includes(delimiter) ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export interface RenderOptions {
  delimiter?: string;
  /** Append a row with one extra field, to exercise W_COLUMN_COUNT. */
  includeRaggedRow?: boolean;
}

/** Renders the fixture as delimited text. */
export function renderFixture(opts: RenderOptions = {}): string {
  const delimiter = opts.delimiter ?? TAB;
  const lines: string[] = [
    LIVEPERSON_HEADERS.map((h) => quote(h, delimiter)).join(delimiter),
  ];

  for (const { row } of FIXTURE_ROWS) {
    lines.push(
      LIVEPERSON_HEADERS.map((h) => quote(row[h] ?? '', delimiter)).join(delimiter),
    );
  }

  if (opts.includeRaggedRow) {
    const ragged = { ...baseRow(), conversationId: 'conv-0019', transcriptAll: SIMPLE_TRANSCRIPT };
    lines.push(
      LIVEPERSON_HEADERS.map((h) => quote(ragged[h] ?? '', delimiter)).join(delimiter) +
        delimiter +
        'unexpected-extra-field',
    );
  }

  return lines.join('\n') + '\n';
}

/** Renders the fixture as a UTF-16LE buffer with a BOM, as Excel would save it. */
export function renderFixtureUtf16le(opts: RenderOptions = {}): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(renderFixture(opts), 'utf16le'),
  ]);
}

/** Renders the fixture as UTF-8 with a BOM. */
export function renderFixtureUtf8Bom(opts: RenderOptions = {}): Buffer {
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(renderFixture(opts), 'utf8'),
  ]);
}
