import { BadRequestException, Injectable } from '@nestjs/common';
import { createProvider } from './providers/provider.factory';
import { buildCallInsightsPrompt, buildChatInsightsPrompt } from './prompt/build-insights-prompt';
import { InsightsProviderName } from './types/insights-provider.type';

// Shared sub-types
type ScoreDimension = {
  score: number | null;
  band: string | null;
  rationale: string;
  timestamp_ref?: string | null;
};

type Coaching = {
  did_well: string[];
  needs_improvement: string[];
  good_quotes: string[];
  bad_quotes: string[];
};

type CustomerSignals = {
  interest_level: string;
  objections: string[];
  decision_timeline: string | null;
  next_step_agreed: string | null;
};

type ClientServices = {
  is_in_market_now: boolean | null;
  has_purchased_elsewhere: boolean | null;
  competitor_purchased: string | null;
  lost_sale: boolean | null;
  lead_generated_for_dealer: boolean;
  dealer_supporting_customer: boolean | null;
  dealer_name: string | null;
  contacted_by_dealership: boolean | null;
  blockers_to_sale: Array<{
    category: string;
    description: string;
    competitor_mentioned: string | null;
  }>;
  competitor_intelligence: Array<{
    brand: string;
    context: string;
    sentiment: 'positive' | 'negative' | 'neutral';
  }>;
};

type ActionItem = {
  description: string;
  owner: 'agent' | 'customer' | 'dealer' | 'unknown';
  due_date_if_mentioned: string | null;
};

type DataQuality = {
  is_too_short: boolean;
  is_unclear: boolean;
  overlapping_speech?: boolean; // calls only
  notes: string;
};

// Call-specific
type CampaignCompliance = {
  itc_statement_read: boolean | null;
  dpa_3_elements_verified: boolean | null;
  four_options_explained: boolean | null;
  lost_sale_identified: boolean | null;
  six_month_callback_advised: boolean | null;
  fpi_confirmed_with_customer_agreement: boolean | null;
  contacted_by_dealership: boolean | null;
};

type SalesOpportunity = {
  is_opportunity: boolean | null;
  not_opportunity_reason: string | null;
  reason_detail: string | null;
};

export type ExtractedInsights = {
  contact_disposition: string;
  conversation_type: string;
  campaign_detected?: string;           // calls only
  summary_short: string;
  summary_detailed: string;
  sentiment_overall: number;
  opportunity?: SalesOpportunity;       // campaign-specific opportunity classification
  customer_signals: CustomerSignals;
  campaign_compliance?: CampaignCompliance; // calls only
  operations: {
    scores: Record<string, ScoreDimension | null>;
    overall_score: number;
    coaching: Coaching;
  };
  qa_assessment?: any;                  // campaign-specific QA scoring (e.g. RAC Q1-Q15)
  client_services: ClientServices;
  action_items: ActionItem[];
  key_entities: Array<{ type: string; value: string }>;
  risk_flags: string[];
  data_quality: DataQuality;
};

function cleanJsonText(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

@Injectable()
export class InsightsService {
  async extractInsights(
    transcript: string,
    interactionType: string | null,
    campaign: string | null,
    provider?: InsightsProviderName,
  ): Promise<{
    providerUsed: string;
    model: string;
    rawJsonText: string;
    parsed: ExtractedInsights;
  }> {
    const isChat = interactionType === 'chat';
    const prompt = isChat
      ? buildChatInsightsPrompt(transcript, campaign)
      : buildCallInsightsPrompt(transcript, campaign);

    const llmProvider = createProvider(provider);
    const result = await llmProvider.extract(prompt);
    const rawJsonText = result.text;

    if (!rawJsonText) throw new Error('Empty insights response');

    const cleanedJsonText = cleanJsonText(rawJsonText);

    let parsed: ExtractedInsights;
    try {
      parsed = JSON.parse(cleanedJsonText);
    } catch {
      console.error('[extractInsights] invalid JSON from model', {
        providerUsed: result.provider,
        model: result.model,
        interactionType,
        campaign,
        rawPreview: rawJsonText.slice(0, 4000),
      });
      throw new BadRequestException('Insights model did not return valid JSON');
    }

    return {
      providerUsed: result.provider,
      model: result.model,
      rawJsonText,
      parsed,
    };
  }
}
