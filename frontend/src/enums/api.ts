export const ApiPath = {
  TranscriptionCall: "/uiapi/transcription/call",
  TranscriptionCallUrl: "/uiapi/transcription/call-url",

  InsightsCall: "/uiapi/insights/call",
  InsightsSummary: "/uiapi/insights/summary",
  InsightsSummaryOperations: "/uiapi/insights/summary/operations",
  InsightsSummaryOperationsTrends: "/uiapi/insights/summary/operations-trends",
  InsightsSummaryAgentTrajectory: "/uiapi/insights/summary/agent-trajectory",

  CsatBoard: "/uiapi/csat/board",
  CsatList: "/uiapi/csat/list",
  CsatRunBatch: "/uiapi/csat/run-batch",
  CsatRematch: "/uiapi/csat/rematch",
  CsatItem: "/uiapi/csat/item", // + /:id, /:id/assess, /:id/requeue
  InsightsSummaryClientServices: "/uiapi/insights/summary/client-services",
  InsightsSummaryObjections: "/uiapi/insights/summary/objections",
  InsightsSummaryObjectionAssessments: "/uiapi/insights/summary/objection-assessments",
  InsightsSummaryCompliance: "/uiapi/insights/summary/compliance",
  InsightsSummaryNarrative: "/uiapi/insights/summary/narrative",
  InsightsSummaryNarratives: "/uiapi/insights/summary/narratives",
  InsightsSummaryFilters: "/uiapi/insights/summary/filters",
  InsightsUsage: "/uiapi/insights/usage",
  InsightsAsk: "/uiapi/insights/ask",

  OpsDimensions: "/uiapi/insights/ops/dimensions",
  OpsInteractionsByBucket: "/uiapi/insights/ops/interactions-by-bucket",
  OpsInteractionsByCoachingNeed: "/uiapi/insights/ops/interactions-by-coaching-need",
  OpsInteractionsByOutcome: "/uiapi/insights/ops/interactions-by-outcome",
  OpsInteractionsByInterestLevel: "/uiapi/insights/ops/interactions-by-interest-level",
  OpsInteractionsByCompetitor: "/uiapi/insights/ops/interactions-by-competitor",
  OpsInteractionsByObjectionCategory: "/uiapi/insights/ops/interactions-by-objection-category",
  OpsInteractionsByPartialOutcome: "/uiapi/insights/ops/interactions-by-partial-outcome",
  OpsInteractionsByLowScoreAgent: "/uiapi/insights/ops/interactions-by-low-score-agent",
  OpsOpportunity: "/uiapi/insights/ops/opportunity",
  OpsVulnerability: "/uiapi/insights/ops/vulnerability",
  OpsVulnerabilityInteractions: "/uiapi/insights/ops/vulnerability-interactions",
  OpsInteractionsByOpportunityReason: "/uiapi/insights/ops/interactions-by-opportunity-reason",
  OpsInteractionDetail: "/uiapi/insights/ops/interaction-detail",
  OpsChatResponseTime: "/uiapi/insights/ops/chat-response-time",
  OpsRecomputeChatResponseTime: "/uiapi/insights/ops/recompute-chat-response-time",

  ParityCampaignAnalysis: "/uiapi/insights/parity/campaign-analysis",
  ClientServicesTrends: "/uiapi/insights/client-services/trends",
  Models: "/uiapi/models",
  ModelInsightsOptions: "/uiapi/models/insights-options",
  ParityInteractions: "/uiapi/insights/parity/interactions",

  SurveyFilters: "/uiapi/survey/filters",
  SurveyOverview: "/uiapi/survey/overview",
  SurveyCategories: "/uiapi/survey/categories",
  SurveyInterestFactors: "/uiapi/survey/interest-factors",
  SurveyNotPurchaseReasons: "/uiapi/survey/not-purchase-reasons",
  SurveyCompetitorPurchases: "/uiapi/survey/competitor-purchases",
  SurveyCompetitorModels: "/uiapi/survey/competitor-models",
  SurveyDealershipRatings: "/uiapi/survey/dealership-ratings",
  SurveyDealerVisits: "/uiapi/survey/dealer-visits",
  SurveyModelPerformance: "/uiapi/survey/model-performance",
  SurveyCompetitorAnalysis: "/uiapi/survey/competitor-analysis",
  SurveyQuarterlyTrends: "/uiapi/survey/quarterly-trends",
  SurveyMonthlyTrends: "/uiapi/survey/monthly-trends",
  SurveyModelRisk: "/uiapi/survey/model-risk",
  SurveyWhyWeLose: "/uiapi/survey/why-we-lose",
  SurveyWhatsWorking: "/uiapi/survey/whats-working",
  SurveyTranscriptInsights: "/uiapi/survey/transcript-insights",
  SurveyDrillRecords: "/uiapi/survey/drill-records",
  SurveyTranscriptDrillRecords: "/uiapi/survey/transcript-drill-records",
  SurveyRecordsByCategory: "/uiapi/survey/records-by-category",
  SurveyRecordsByCompetitor: "/uiapi/survey/records-by-competitor",
  SurveyRecordDetail: "/uiapi/survey/record",

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
