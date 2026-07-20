import api from "@/services/api";

export interface InteractionSearchResult {
  id: string;
  interactionId: string | null;
  interactionTpsId: string | null;
  interactionType: string | null;
  campaign: string | null;
  agent: string | null;
  interactionDateTime: string | null;
  outcome: string | null;
  summaryShort: string | null;
}

export interface InteractionDetail {
  interaction: {
    id: string;
    agent: string | null;
    campaign: string | null;
    interactionType: string | null;
    interactionDateTime: string | null;
    status: string;
    interactionId: string | null;
    interactionTpsId: string | null;
    interactionSource: string | null;
    recordingUrl: string | null;
    outcome: string | null;
  };
  transcript: {
    text: string;
    model: string | null;
    confidence?: number | null;
    low_confidence?: Array<{ word: string; confidence: number; count: number }> | null;
  } | null;
  insight: {
    summary_short: string | null;
    summary_detailed: string | null;
    sentiment_overall: number | null;
    overall_score: number | null;
    contact_disposition: string | null;
    conversation_type: string | null;
    interest_level: string | null;
    campaign_detected: string | null;
    decision_timeline: string | null;
    next_step_agreed: string | null;
    // Campaign-specific Q&A blob (e.g. Parity). Shape varies per campaign,
    // owned by the matching call.campaign.<NAME>.qa_schema prompt fragment.
    campaign_answers?: Record<string, any> | null;
  } | null;
  // Present only for survey interactions (conversation_type='survey'): the full
  // projected survey answer set + mined transcript insights. Drives the survey
  // sections in the shared drawer. Null/absent for non-survey interactions.
  survey?: Record<string, any> | null;
}

export async function searchInteractions(q: string) {
  const { data } = await api.get<InteractionSearchResult[]>(
    "/uiapi/insights/interactions/search",
    { params: { q } },
  );
  return data;
}

export async function getInteractionDetail(id: string) {
  const { data } = await api.get<InteractionDetail>(
    `/uiapi/insights/ops/interaction-detail/${id}`,
  );
  return data;
}
