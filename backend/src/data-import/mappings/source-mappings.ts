// Source mappings for the data importer. One entry per upstream provider.
//
// Adding a provider means adding a SourceMapping here — no schema change, no
// parser change. Everything provider-specific lives in this file.

import { SourceMapping, SqlSourceParams } from './mapping.types';

// ─── ICX call-centre (SQL-sourced) ───────────────────────────────────────────
//
// Unlike LivePerson's raw CSV columns, this query already joins historycall +
// Opportunity + dim.list (x2) + maxcontact.allocation.allocationqueue and
// resolves clean, typed, sized values (LOWER(), CAST(), resolved names) — much
// closer to the ad-hoc sql/interaction_build.sql's shape than to a file export.
// So the FieldMap below is almost entirely direct 1:1 carries, no alias/
// truncation rules needed.
//
// `icx-rep` is a SQL Server linked server configured at the instance level —
// reachable via three/four-part names in any query run against this app's own
// database (see sql-source-reader.ts), exactly like this codebase's existing
// ad-hoc scripts (nmgb_survey_load.sql, sql/interaction_build.sql) already do.

/**
 * Which ICX campaign (dim.list.listgrouping value) each seeded client's calls
 * live under. One more entry here is all a new client campaign needs — no new
 * UI control, since the Client selector (already mandatory at stage time) is
 * what picks this.
 */
const ICX_CAMPAIGN_BY_CLIENT: Record<string, string> = {
  nmgb: 'NMGB Survey',
};

function resolveIcxCampaign(clientKey: string): string {
  const campaign = ICX_CAMPAIGN_BY_CLIENT[clientKey];
  if (!campaign) {
    throw new Error(
      `No ICX campaign mapping for client "${clientKey}" yet — add one to ` +
        `ICX_CAMPAIGN_BY_CLIENT in source-mappings.ts.`,
    );
  }
  return campaign;
}

/**
 * "Ignore calls there's no point transcribing" — result codes that mean no
 * useful conversation happened (no answer, refused, wrong number, ...). Kept
 * as a named, reviewable constant rather than buried inline in the query text.
 */
const ICX_CALLS_EXCLUDED_RESULT_CODES = [
  'AGAM',
  'DECEASED',
  'HKT',
  'HKT_WARM',
  'HKTCSREJ',
  'NOANSWER',
  'NPCB',
  'REFUSED',
  'REFUSEDDPA',
  'WRONGNO',
];

function buildIcxCallsQuery(params: SqlSourceParams): { text: string; values: unknown[] } {
  const campaign = resolveIcxCampaign(params.clientKey);
  const excludedList = ICX_CALLS_EXCLUDED_RESULT_CODES.map((c) => `'${c}'`).join(', ');
  return {
    text: `
      SELECT
        historycall.[call recording]      AS recordingUrl,
        CAST(history_id AS VARCHAR(50))   AS interactionId,
        CAST(reference_id AS VARCHAR(50)) AS interactionTpsId,
        list2.listgrouping                AS campaign,
        historycall.start_date_time       AS interactionDateTime,
        historycall.user_routing          AS agent,
        historycall.result_code           AS outcome,
        allocationqueue.maturitydate      AS maturityDate,
        allocationqueue.make              AS vehicleMake,
        allocationqueue.model             AS vehicleModel,
        allocationqueue.dealername        AS dealer,
        list.list                         AS campaignOriginal
      FROM [icx-rep].bi.historycall WITH (NOLOCK)
      INNER JOIN [icx-rep].bi.Opportunity WITH (NOLOCK)
        ON Opportunity.[IDaction] = historycall.reference_id
      INNER JOIN [icx-rep].dim.list WITH (NOLOCK)
        ON [original list id] = list.idlist
      INNER JOIN [icx-rep].dim.list list2 WITH (NOLOCK)
        ON [list id] = list2.idlist
      INNER JOIN maxcontact.allocation.allocationqueue
        ON historycall.reference_id = allocationqueue.idaction
      WHERE historycall.start_date_time BETWEEN @0 AND @1
        AND ISNULL(historycall.[call recording], '') <> ''
        AND historycall.result_code NOT IN (${excludedList})
        AND list2.listgrouping = @2
    `,
    values: [params.from, params.to, campaign],
  };
}

/**
 * Builds an ICX-calls mapping for a given transcription engine. The operator
 * picks Deepgram vs OpenAI by choosing which of the two registered sources to
 * stage (see SOURCE_MAPPINGS below) rather than a separate per-run control —
 * recordings.service.ts's transcribeOne branches on exactly this `provider`
 * value, with the Deepgram path built specifically to work around MaxContact's
 * non-Range download endpoint.
 */
function buildIcxCallsMapping(opts: {
  key: string;
  label: string;
  provider: string;
}): SourceMapping {
  return {
    key: opts.key,
    label: opts.label,
    version: '1',
    sourceKind: 'sql',
    sql: { buildQuery: buildIcxCallsQuery },
    // Recordings are staged ahead of transcription — done later via this
    // tool's own transcription pipeline, not at import time.
    transcriptExpected: false,
    // Unused for a SQL source (no file to sniff); dateOrder matters, since
    // the SQL reader stringifies dates as naive ISO (see sql-source-reader.ts).
    delimiter: 'auto',
    dateOrder: 'iso',
    multiValueDelimiter: ';',
    naturalKeyCandidates: ['interactionId'],
    fields: [
      // interactionId is the natural key (derived by stageRow itself, not a
      // FieldMap). interactionTpsId is mapped explicitly because it differs —
      // reference_id is the underlying opportunity/action id, which can be
      // shared across multiple call attempts to the same lead.
      {
        target: 'interactionTpsId',
        column: 'interactionTpsId',
        transform: 'trim',
        maxLength: 50,
        hardKey: true,
      },
      { target: 'campaign', column: 'campaign', transform: 'trim', maxLength: 50 },
      { target: 'interactionDateTime', column: 'interactionDateTime', transform: 'datetime' },
      { target: 'agent', column: 'agent', transform: 'trim', maxLength: 100 },
      { target: 'outcome', column: 'outcome', transform: 'trim', maxLength: 200 },
      { target: 'vehicleMake', column: 'vehicleMake', transform: 'trim', maxLength: 100 },
      { target: 'vehicleModel', column: 'vehicleModel', transform: 'trim', maxLength: 100 },
      { target: 'dealer', column: 'dealer', transform: 'trim', maxLength: 200 },
      { target: 'recordingUrl', column: 'recordingUrl', transform: 'trim', maxLength: 2048 },
      { target: 'maturityDate', column: 'maturityDate', transform: 'datetime' },
    ],
    transcript: {
      column: '',
      agentNameColumns: [],
      agentLabels: [],
      customerLabels: [],
      systemLabels: [],
      botLabels: [],
    },
    csat: { scoreMax: 5, commentColumns: [] },
    survey: { type: '', pairs: [] },
    pii: { dropColumns: [] },
    interactionDefaults: {
      provider: opts.provider,
      interactionSource: 'maxcontact',
      interactionType: 'call',
      status: 'pending_transcription',
    },
  };
}

export const ICX_CALLS_DEEPGRAM_MAPPING = buildIcxCallsMapping({
  key: 'icx_calls',
  label: 'ICX Call Centre (calls — Deepgram transcription)',
  provider: 'deepgram',
});

export const ICX_CALLS_OPENAI_MAPPING = buildIcxCallsMapping({
  key: 'icx_calls_openai',
  label: 'ICX Call Centre (calls — OpenAI transcription)',
  provider: 'openai',
});

// ─── ICX survey (attaches to an already-promoted icx_calls interaction) ─────
//
// Adapts backend/sql/nmgb_survey_load.sql — which already builds the exact
// nested answersJson shape the Survey Insights dashboards depend on
// (competitor_purchase.make, purchase_status.still_considering, ...) — into a
// SELECT instead of an INSERT. That shape does NOT fit the flat SurveyAnswer[]
// LivePerson's inline Q&A pairs produce, so this uses `survey.rawJsonColumn`
// to carry the FOR JSON PATH subquery's output straight through unchanged
// rather than flattening it.
function buildIcxSurveyQuery(params: SqlSourceParams): { text: string; values: unknown[] } {
  const campaign = resolveIcxCampaign(params.clientKey);
  return {
    text: `
      SELECT
        i.interactionId                          AS interactionId,
        i.interactionTpsId                        AS interactionTpsId,
        i.campaign                                AS campaign,
        i.recordingUrl                            AS recordingUrl,
        i.interactionDateTime                     AS interactionDateTime,
        i.interactionDateTime                     AS respondedAt,
        (
          SELECT
            'NMGB'                                                 AS [survey],
            s.[IDOpportunity]                                      AS [meta.id_opportunity],
            s.[Survey Data Status]                                 AS [meta.data_status],
            s.[Survey Flow Status]                                 AS [meta.flow_status],
            s.[P2 Q1 Has Not Purchased Yet]                        AS [purchase_status.has_not_purchased_yet],
            s.[P2 Q2 Still Considering]                            AS [purchase_status.still_considering],
            s.[P3 Q1 Interest Follow Up]                           AS [follow_up_interest],
            s.[P4 Q1 Initial Interest Styling Design]              AS [initial_interest.styling_design],
            s.[P4 Q1 Initial Interest Brand Reputation]            AS [initial_interest.brand_reputation],
            s.[P4 Q1 Initial Interest Brand Loyalty]               AS [initial_interest.brand_loyalty],
            s.[P4 Q1 Initial Interest Recommendation]              AS [initial_interest.recommendation],
            s.[P4 Q1 Initial Interest Features]                    AS [initial_interest.features],
            s.[P4 Q1 Initial Interest Size Practicality]           AS [initial_interest.size_practicality],
            s.[P4 Q1 Initial Interest Performance]                 AS [initial_interest.performance],
            s.[P4 Q1 Initial Interest Price Value]                 AS [initial_interest.price_value],
            s.[P4 Q1 Initial Interest Other]                       AS [initial_interest.other],
            s.[P4 Q1 Initial Interest Other Feedback]              AS [initial_interest.other_feedback],
            s.[P4 Q2 Did you visit]                                AS [dealer_visit.visited],
            s.[P4 Q2a Impression of Vehicle]                       AS [dealer_visit.vehicle_impression],
            s.[P4 Q2b Why No Test Drive]                           AS [dealer_visit.why_no_test_drive],
            s.[P4 Q3 Dealership Rating]                            AS [dealership_rating.score],
            s.[P4 Q3a Dealership Rating Feedback]                  AS [dealership_rating.feedback],
            s.[P4 Q4 Not Purchase Reason Price]                    AS [not_purchased_reasons.price],
            s.[P4 Q4 Not Purchase Reason Price Sub Reason]         AS [not_purchased_reasons.price_sub_reason],
            s.[P4 Q4 Not Purchase Reason Expectations]             AS [not_purchased_reasons.expectations],
            s.[P4 Q4 Not Purchase Reason Expectations Sub Reason]  AS [not_purchased_reasons.expectations_sub_reason],
            s.[P4 Q4 Not Purchase Reason Purchase Different Brand] AS [not_purchased_reasons.different_brand],
            s.[P4 Q4 Not Purchase Reason Purchase Different Client Model] AS [not_purchased_reasons.different_client_model],
            s.[P4 Q4 Not Purchase Reason Financing]                AS [not_purchased_reasons.financing],
            s.[P4 Q4 Not Purchase Reason Financing Sub Reason]     AS [not_purchased_reasons.financing_sub_reason],
            s.[P4 Q4 Not Purchase Reason Dealership Experience]    AS [not_purchased_reasons.dealership_experience],
            s.[P4 Q4 Not Purchase Reason Dealership Experience Sub Reason] AS [not_purchased_reasons.dealership_experience_sub_reason],
            s.[P4 Q4 Not Purchase Reason No Interest in EVs]       AS [not_purchased_reasons.no_interest_in_evs],
            s.[P4 Q4 Not Purchase Reason Purchased MOI on Record]  AS [not_purchased_reasons.purchased_moi_on_record],
            s.[P4 Q4 Not Purchase Reason Other]                    AS [not_purchased_reasons.other],
            s.[P4 Q4 Not Purchase Reason Other Feedback]           AS [not_purchased_reasons.other_feedback],
            s.[P4 Q5 Purchase Another Vehicle]                     AS [competitor_purchase.purchased_another_vehicle],
            s.[P4 Q5 Purchase Make]                                AS [competitor_purchase.make],
            s.[P4 Q5 Purchase Model]                               AS [competitor_purchase.model],
            s.[P4 Q5 Purchase Other Model Not Listed]              AS [competitor_purchase.other_model_not_listed],
            s.[P4 Q5 Purchase New Used]                            AS [competitor_purchase.new_used],
            s.[P4 Q6 Influenced APR Lower]                         AS [influenced_by.apr_lower],
            s.[P4 Q6 Influenced Better Value]                      AS [influenced_by.better_value],
            s.[P4 Q6 Influenced Brand Loyalty]                     AS [influenced_by.brand_loyalty],
            s.[P4 Q6 Influenced Colour Spec Pref]                  AS [influenced_by.colour_spec_pref],
            s.[P4 Q6 Influenced Comfortable Interior]              AS [influenced_by.comfortable_interior],
            s.[P4 Q6 Influenced Customer Service]                  AS [influenced_by.customer_service],
            s.[P4 Q6 Influenced Discount]                          AS [influenced_by.discount],
            s.[P4 Q6 Influenced Drive Of Vehicle]                  AS [influenced_by.drive_of_vehicle],
            s.[P4 Q6 Influenced Enhanced Features]                 AS [influenced_by.enhanced_features],
            s.[P4 Q6 Influenced Longer Warranty]                   AS [influenced_by.longer_warranty],
            s.[P4 Q6 Influenced Monthly Payments Lower]            AS [influenced_by.monthly_payments_lower],
            s.[P4 Q6 Influenced Powertrain Options]                AS [influenced_by.powertrain_options],
            s.[P4 Q6 Influenced Pref Design]                       AS [influenced_by.pref_design],
            s.[P4 Q6 Influenced Quicker Delivery]                  AS [influenced_by.quicker_delivery],
            s.[P4 Q6 Influenced Size]                              AS [influenced_by.size],
            s.[P4 Q6 Influenced Try Different]                     AS [influenced_by.try_different],
            s.[P4 Q6 Influenced Purchased MOI on Record]           AS [influenced_by.purchased_moi_on_record],
            s.[P4 Q6 Influenced Other]                             AS [influenced_by.other],
            s.[P4 Q6 Influenced Other Feedback]                    AS [influenced_by.other_feedback],
            s.[P4 Q7 Purchase Reason For]                          AS [purchase_reason],
            s.[P4 Q8 Improve Anything Different]                   AS [improvements.anything_different],
            s.[P4 Q9 Improve Follow Up]                            AS [improvements.follow_up],
            s.[Agent Notes]                                        AS [agent_notes],
            s.[Complaint Type]                                     AS [complaint.type],
            s.[Complaint Type Category]                            AS [complaint.category]
          FROM [icx-rep].[bi].[LeadDataSurvey_NMGB] s
          WHERE LTRIM(RTRIM(s.[Call Recording])) = LTRIM(RTRIM(i.recordingUrl)) COLLATE DATABASE_DEFAULT
          FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        ) AS answersJsonRaw
      FROM app.interactions i
      WHERE i.campaign = @0
        AND i.interactionDateTime BETWEEN @1 AND @2
        AND EXISTS (
          SELECT 1 FROM [icx-rep].[bi].[LeadDataSurvey_NMGB] s
          WHERE LTRIM(RTRIM(s.[Call Recording])) = LTRIM(RTRIM(i.recordingUrl)) COLLATE DATABASE_DEFAULT
        )
        AND NOT EXISTS (
          SELECT 1 FROM app.interaction_survey xs WHERE xs.recordingId = i.id
        )
    `,
    values: [campaign, params.from, params.to],
  };
}

export const ICX_SURVEY_MAPPING: SourceMapping = {
  key: 'icx_survey',
  label: 'ICX Survey (attaches to an existing call)',
  version: '1',
  sourceKind: 'sql',
  sql: { buildQuery: buildIcxSurveyQuery },
  attachToExisting: { matchColumn: 'recordingUrl' },
  transcriptExpected: false,
  delimiter: 'auto',
  dateOrder: 'iso',
  multiValueDelimiter: ';',
  naturalKeyCandidates: ['interactionId'],
  fields: [
    {
      target: 'interactionTpsId',
      column: 'interactionTpsId',
      transform: 'trim',
      maxLength: 50,
      hardKey: true,
    },
    { target: 'campaign', column: 'campaign', transform: 'trim', maxLength: 50 },
    { target: 'interactionDateTime', column: 'interactionDateTime', transform: 'datetime' },
    { target: 'recordingUrl', column: 'recordingUrl', transform: 'trim', maxLength: 2048 },
    { target: 'csatRespondedAt', column: 'respondedAt', transform: 'datetime' },
  ],
  transcript: {
    column: '',
    agentNameColumns: [],
    agentLabels: [],
    customerLabels: [],
    systemLabels: [],
    botLabels: [],
  },
  csat: { scoreMax: 5, commentColumns: [] },
  // 'nmgb' matches the surveyType nmgb_survey_load.sql already writes, so rows
  // loaded either way land in the same namespace.
  survey: { type: 'nmgb', pairs: [], rawJsonColumn: 'answersJsonRaw' },
  pii: { dropColumns: [] },
  interactionDefaults: {
    // Never read in attach mode — promote skips the interactions INSERT
    // entirely — but the type requires the shape.
    provider: 'n/a',
    interactionSource: 'maxcontact',
    interactionType: 'call',
    status: 'pending_transcription',
  },
};

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
    // Everything on this LivePerson account is RAC business, so any campaign that
    // does not already say so is prefixed rather than left to lose its QA scoring.
    //
    // Measured on a real 9,742-row export (13-29 Jul 2026): 30 distinct values,
    // 28 already containing "RAC" (e.g. "Web - RAC Sales - Breakdown Journey
    // (Mobile)"), and 2 not — "prmsg tWQVPTpxg" (904 rows) and "NA" (350 rows),
    // 1,254 rows / 12.9% in total. Those become "RAC - prmsg tWQVPTpxg" and
    // "RAC - NA".
    //
    // A prefix rather than an alias list because "prmsg tWQVPTpxg" carries a
    // generated suffix — next month's export will have a different one, which a
    // literal alias could not anticipate.
    //
    // WIDTH WARNING: the longest real value, "Web - RAC Sales - NonCashback
    // Affiliates (Desktop)", is EXACTLY 50 characters. There is no headroom, so a
    // slightly longer campaign in a future export will be truncated (with a
    // warning) and would fragment dashboard grouping. Widening
    // interactions.campaign is a migration on an indexed column.
    {
      target: 'campaign',
      column: ['campaignName', 'goalName'],
      transform: 'trim',
      maxLength: 50,
      fallback: 'RAC',
      mustMatch: 'rac',
      prefixWhenUnmatched: 'RAC - ',
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
  [ICX_CALLS_DEEPGRAM_MAPPING.key]: ICX_CALLS_DEEPGRAM_MAPPING,
  [ICX_CALLS_OPENAI_MAPPING.key]: ICX_CALLS_OPENAI_MAPPING,
  [ICX_SURVEY_MAPPING.key]: ICX_SURVEY_MAPPING,
};

export function getSourceMapping(key: string): SourceMapping | undefined {
  return SOURCE_MAPPINGS[key];
}

export function listSourceMappings(): SourceMapping[] {
  return Object.values(SOURCE_MAPPINGS);
}
