// Source mappings for the data importer. One entry per upstream provider.
//
// Adding a provider means adding a SourceMapping here — no schema change, no
// parser change. Everything provider-specific lives in this file.

import { SourceMapping } from './mapping.types';

/**
 * LivePerson Conversational Cloud tabular export (RAC chat).
 *
 * One row per conversation, ~330 columns, transcript inline in `transcriptAll`.
 * Delivered as .csv but historically TAB-separated, hence delimiter: 'auto'.
 */
export const LIVEPERSON_MAPPING: SourceMapping = {
  key: 'liveperson',
  label: 'LivePerson (chat export)',
  version: '1',
  delimiter: 'auto',
  dateOrder: 'dmy',
  multiValueDelimiter: ';',

  // conversationId is column 1. '#1' is retained as a positional fallback in
  // case the header is renamed or blank; the resolved choice is recorded on the
  // run and overridable from the UI.
  naturalKeyCandidates: [
    'conversationId',
    'interactionContextId',
    'sessionId',
    '#1',
  ],

  fields: [
    // ── source identity (full length, for QA) ────────────────────────────────
    { target: 'srcSessionId', column: 'sessionId', transform: 'trim', maxLength: 200 },
    {
      target: 'srcInteractionContextId',
      column: 'interactionContextId',
      transform: 'trim',
      maxLength: 200,
    },

    // ── canonical projection of app.interactions ─────────────────────────────
    // interactionId / interactionTpsId / srcConversationId are derived from the
    // resolved natural key rather than a fixed column, so they are set by the
    // projector, not by a FieldMap.
    {
      target: 'interactionDateTime',
      column: ['startTimeLOCAL', 'startTimeUTC', 'startTime', 'startTimeDate'],
      transform: 'datetime',
    },
    // campaign MUST match /rac/i or imported chats silently lose the RAC QA
    // assessment and objection-handling sections of the chat insights prompt
    // (isRacCampaign in insights/prompt/build-insights-prompt.ts). It is also
    // only varchar(50) and is grouped on by every dashboard, so it is aliased
    // to a short canonical value rather than truncated.
    {
      target: 'campaign',
      column: ['campaignName', 'goalName'],
      transform: 'trim',
      maxLength: 50,
      fallback: 'RAC',
      aliases: {
        // Populate from the real file's campaignName distribution in phase 3.
        // Every value must contain "RAC".
      },
      mustMatch: 'rac',
      mustMatchHint:
        'campaign must contain "RAC" or the chat insights prompt skips the RAC ' +
        'QA assessment and objection-handling sections',
    },
    {
      target: 'agent',
      column: ['latestAgentFullName', 'latestAgentNickname', 'latestAgentLoginName'],
      transform: 'trim',
      maxLength: 100,
    },
    // dealer is deliberately unmapped: this feed is RAC-level, not per-dealer.
    {
      target: 'outcome',
      column: ['closeReasonDescription', 'closeReason', 'status'],
      transform: 'trim',
      maxLength: 200,
    },

    // ── QA-only ──────────────────────────────────────────────────────────────
    { target: 'skill', column: 'latestSkillName', transform: 'trim', maxLength: 200 },
    {
      target: 'agentGroup',
      column: 'latestAgentGroupName',
      transform: 'trim',
      maxLength: 200,
    },
    { target: 'lob', column: 'lobName', transform: 'trim', maxLength: 200 },
    { target: 'locationName', column: 'LocationName', transform: 'trim', maxLength: 200 },
    { target: 'durationSeconds', column: 'duration', transform: 'int' },
    { target: 'srcMessageCount', column: 'messageCount', transform: 'int' },
    { target: 'srcMessageCountAgent', column: 'messageCountAgent', transform: 'int' },
    {
      target: 'srcMessageCountConsumer',
      column: 'messageCountConsumer',
      transform: 'int',
    },
    { target: 'closeReason', column: 'closeReason', transform: 'trim', maxLength: 100 },
    { target: 'isPartial', column: 'isPartial', transform: 'bool' },
    { target: 'isTruncated', column: 'isTruncated', transform: 'bool' },

    // ── CSAT / quality ───────────────────────────────────────────────────────
    // csatRate is the customer-stated post-chat score and the like-for-like
    // with the existing CSAT pipeline. LivePerson leaves it 0/blank unless a
    // survey was actually answered, so it is gated on csatCount.
    {
      target: 'csatScore',
      column: 'csatRate',
      transform: 'int',
      requiresPositive: 'csatCount',
    },
    { target: 'csatScoreMax', const: 5 },
    { target: 'csatRespondedAt', column: ['summaryTimeUTC', 'endTimeUTC'], transform: 'datetime' },
    // mcs is LivePerson's own sentiment-derived score, not customer-stated. Kept
    // for analysis but never used as the CSAT score.
    { target: 'mcs', column: 'mcs', transform: 'int' },
    { target: 'alertedMcs', column: 'alertedMCS', transform: 'bool' },

    // ── survey ───────────────────────────────────────────────────────────────
    {
      target: 'surveyType',
      column: ['surveyTypePostSurvey', 'surveyType'],
      transform: 'trim',
      maxLength: 50,
    },
    {
      target: 'surveyStatus',
      column: ['surveyStatusPostSurvey', 'surveyStatus'],
      transform: 'trim',
      maxLength: 50,
    },

    // ── content ──────────────────────────────────────────────────────────────
    // No trim: leading whitespace is part of the transcript's line structure.
    { target: 'transcriptRaw', column: 'transcriptAll' },
    { target: 'summaryText', column: 'summaryText', transform: 'trim' },
  ],

  transcript: {
    column: 'transcriptAll',
    agentColumn: 'transcriptAgent',
    consumerColumn: 'transcriptConsumer',
    agentNameColumns: [
      'latestAgentFullName',
      'latestAgentNickname',
      'latestAgentLoginName',
    ],
    agentLabels: ['agent', 'colleague', 'operator', 'rep'],
    // Must stay a superset-compatible match for CUSTOMER_LABELS in
    // insights/chat-response-time.ts, which accepts consumer|customer|user|visitor.
    customerLabels: ['consumer', 'customer', 'user', 'visitor'],
    systemLabels: ['system', 'info'],
    botLabels: ['bot', 'virtual assistant', 'va'],
  },

  csat: {
    scoreMax: 5,
    commentColumns: ['surveyAnswerPostSurvey', 'surveyAnswer'],
  },

  survey: {
    type: 'liveperson_post_chat',
    pairs: [
      {
        block: 'post_chat',
        question: 'surveyQuestionPostSurvey',
        answer: 'surveyAnswerPostSurvey',
        questionId: 'surveyQuestionIdPostSurvey',
        answerId: 'surveyAnswerIdPostSurvey',
        questionType: 'surveyQuestionTypePostSurvey',
        questionFormat: 'surveyQuestionFormatPostSurvey',
      },
      {
        block: 'in_chat',
        question: 'surveyQuestion',
        answer: 'surveyAnswer',
      },
    ],
  },

  // Consumer contact details are dropped before rawJson is built — they never
  // reach the database. Nothing in the app consumes them, and persisting them
  // would turn an insights warehouse into a consumer-identity datastore.
  pii: {
    dropColumns: [
      'consumerParticipantsEmail',
      'consumerParticipantsFirstName',
      'consumerParticipantsLastName',
      'consumerParticipantsPhone',
      'consumerParticipantsConsumerName',
      'consumerParticipantsToken',
      'personalInfo-name',
      'personalInfo-surname',
      'personalInfo-email',
      'personalInfo-phone',
      'personalInfo-gender',
      'personalInfo-customerAge',
      'customerInfo-*',
      'unauthcustomerInfo-*',
      'ipAddress',
      'monitoring-ipAddress',
      'sdes',
    ],
  },

  interactionDefaults: {
    // provider is the LLM/transcription provider (normalizeProvider only allows
    // openai|anthropic|grok|gemini) — provenance goes in interactionSource.
    provider: 'openai',
    interactionSource: 'liveperson',
    interactionType: 'chat',
    // Must be 'transcribed': startBatchInsightsChats selects
    // status IN ('transcribed') AND interactionType = 'chat'. Anything else
    // strands the rows outside every batch queue.
    status: 'transcribed',
  },
};

export const SOURCE_MAPPINGS: Record<string, SourceMapping> = {
  [LIVEPERSON_MAPPING.key]: LIVEPERSON_MAPPING,
};

export function getSourceMapping(key: string): SourceMapping | undefined {
  return SOURCE_MAPPINGS[key];
}

export function listSourceMappings(): SourceMapping[] {
  return Object.values(SOURCE_MAPPINGS);
}
