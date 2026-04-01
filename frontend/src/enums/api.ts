export const ApiPath = {
  TranscriptionCall: "/uiapi/transcription/call",
  TranscriptionCallUrl: "/uiapi/transcription/call-url",

  InsightsCall: "/uiapi/insights/call",
  InsightsSummary: "/uiapi/insights/summary",
  InsightsSummaryOperations: "/uiapi/insights/summary/operations",
  InsightsSummaryClientServices: "/uiapi/insights/summary/client-services",
  InsightsSummaryObjections: "/uiapi/insights/summary/objections",
  InsightsSummaryCompliance: "/uiapi/insights/summary/compliance",
  InsightsSummaryNarrative: "/uiapi/insights/summary/narrative",
  InsightsSummaryNarratives: "/uiapi/insights/summary/narratives",
  InsightsSummaryFilters: "/uiapi/insights/summary/filters",

  OpsDimensions: "/uiapi/insights/ops/dimensions",
  OpsInteractionsByBucket: "/uiapi/insights/ops/interactions-by-bucket",
  OpsInteractionsByCoachingNeed: "/uiapi/insights/ops/interactions-by-coaching-need",
  OpsInteractionsByOutcome: "/uiapi/insights/ops/interactions-by-outcome",
  OpsInteractionDetail: "/uiapi/insights/ops/interaction-detail",

  Recordings: "/uiapi/recordings",
} as const;

export const TranscriptionProvider = {
  OpenAI: "openai",
  Deepgram: "deepgram",
} as const;

export type TranscriptionProvider =
  (typeof TranscriptionProvider)[keyof typeof TranscriptionProvider];

export const InsightsProvider = {
  OpenAI: "openai",
  Anthropic: "anthropic",
  Grok: "grok",
  Gemini: "gemini",
} as const;

export type InsightsProvider =
  (typeof InsightsProvider)[keyof typeof InsightsProvider];
