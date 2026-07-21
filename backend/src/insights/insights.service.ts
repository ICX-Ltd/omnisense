import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createProvider } from './providers/provider.factory';
import { PromptsService } from '../modules/prompts/prompts.service';
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

type ObjectionCategoryAssessment = {
  raised: boolean;
  best_practice_followed: boolean | null;
  could_do_more: boolean | null;
  comment: string;
};

export type ChatResponsePair = {
  customer_at: string | null;
  agent_at: string | null;
  gap_seconds: number | null;
  agent_message_preview: string;
  is_auto_message: boolean;
  is_last_pair: boolean;
};

export type ChatResponseMetrics = {
  pairs: ChatResponsePair[];
};

type ObjectionAssessment = {
  categories: Record<string, ObjectionCategoryAssessment>;
  generic_checklist: {
    acknowledged_concern: boolean | null;
    clarified_reason: boolean | null;
    reframed_value: boolean | null;
    offered_solution: boolean | null;
    maintained_control: boolean | null;
    progressed_next_step: boolean | null;
  };
  objections_raised_count: number;
  checklist_score: number | null;
  overall_handling_comment: string;
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
    scoring_flags?: {
      partial_scoring: boolean;
      partial_scoring_reason: string | null;
      low_score_alert: boolean;
      low_score_dimensions: string[];
    };
  };
  qa_assessment?: any;                  // campaign-specific QA scoring (e.g. RAC Q1-Q15)
  objection_assessment?: ObjectionAssessment; // campaign-specific objection handling
  campaign_answers?: Record<string, any>;     // campaign-specific Q&A blob (e.g. Parity)
  campaign_transcript?: Record<string, any>;  // campaign-specific transcript insight blob (e.g. NMGB Survey)
  client_services: ClientServices;
  action_items: ActionItem[];
  key_entities: Array<{ type: string; value: string }>;
  risk_flags: string[];
  data_quality: DataQuality;
};

export function cleanJsonText(text: string): string {
  let cleaned = text.trim();
  // Strip ```json ... ``` fences.
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
    cleaned = cleaned.trim();
  }
  // Salvage: if the model wrapped the object in prose ("Here is the JSON: {...}
  // Hope that helps!"), slice from the first brace to the last. Idempotent for a
  // clean object; only changes anything when there's surrounding text.
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }
  return cleaned.trim();
}

/**
 * Shared, mutable spend guard for one batch run. extractInsights adds the tokens
 * burned on FAILED attempts to `wastedTokens`; once that reaches
 * `failedTokenBudget` (when > 0), further retries are skipped so a bad batch
 * can't run away on cost. Pass the SAME instance to every record in a batch.
 */
export interface ExtractBudget {
  failedTokenBudget: number;
  wastedTokens: number;
  tripped: boolean;
}

export interface ExtractUsage {
  inputTokens: number; // successful attempt
  outputTokens: number; // successful attempt
  attempts: number;
  failedInputTokens: number; // summed across failed attempts (retry waste)
  failedOutputTokens: number;
}

// Reported once per attempt (success OR failure) so the caller can durably log
// every token spent — including attempts on records that ultimately fail.
export interface ExtractAttemptLog {
  provider: string;
  model: string;
  attempt: number;
  outcome: 'success' | 'invalid_json' | 'truncated' | 'empty';
  truncated: boolean;
  inputTokens: number;
  outputTokens: number;
}

export function makeExtractBudget(): ExtractBudget {
  return {
    failedTokenBudget:
      parseInt(process.env.INSIGHTS_BATCH_FAILED_TOKEN_BUDGET ?? '5000000', 10) || 0,
    wastedTokens: 0,
    tripped: false,
  };
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(private readonly promptsService: PromptsService) {}

  async extractInsights(
    transcript: string,
    interactionType: string | null,
    campaign: string | null,
    provider?: InsightsProviderName,
    budget?: ExtractBudget,
    onAttempt?: (a: ExtractAttemptLog) => void,
    model?: string,
  ): Promise<{
    providerUsed: string;
    model: string;
    rawJsonText: string;
    parsed: ExtractedInsights;
    usage: ExtractUsage;
    promptVersions: Record<string, number>;
  }> {
    const isChat = interactionType === 'chat';
    const { prompt, promptVersions } = isChat
      ? await this.promptsService.composeChatPrompt(transcript, campaign)
      : await this.promptsService.composeCallPrompt(transcript, campaign);

    const llmProvider = createProvider(provider, model);

    // Extraction is non-deterministic (temperature > 0) and the JSON is large,
    // so a given transcript may truncate or emit invalid JSON on one sample and
    // succeed on the next. Re-roll a bounded number of times rather than failing
    // the record — this automates the manual "run the batch again" workaround.
    const maxAttempts = Math.max(
      1,
      (parseInt(process.env.INSIGHTS_EXTRACT_RETRIES ?? '2', 10) || 0) + 1,
    );

    let lastReason = 'unknown';
    let lastPreview = '';
    let lastProvider = '';
    let lastModel = '';
    let failedInputTokens = 0;
    let failedOutputTokens = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await llmProvider.extract(prompt);
      lastProvider = result.provider;
      lastModel = result.model;
      const rawJsonText = result.text;
      const inTok = result.usage?.inputTokens ?? 0;
      const outTok = result.usage?.outputTokens ?? 0;

      let parsed: ExtractedInsights | null = null;
      if (!rawJsonText) {
        lastReason = 'empty response';
      } else {
        lastPreview = rawJsonText.slice(0, 2000);
        try {
          parsed = JSON.parse(cleanJsonText(rawJsonText));
        } catch {
          lastReason = 'invalid JSON';
        }
        // A truncated response sometimes still parses but is incomplete — reject
        // it so we don't persist a partial record.
        if (parsed && result.truncated) {
          lastReason = 'truncated (hit max_tokens)';
          parsed = null;
        }
      }

      // Report this attempt's usage regardless of outcome (durable cost log).
      onAttempt?.({
        provider: result.provider,
        model: result.model,
        attempt,
        outcome: parsed
          ? 'success'
          : !rawJsonText
            ? 'empty'
            : result.truncated
              ? 'truncated'
              : 'invalid_json',
        truncated: !!result.truncated,
        inputTokens: inTok,
        outputTokens: outTok,
      });

      if (parsed) {
        if (attempt > 1) {
          this.logger.log(
            `Insights extraction recovered on attempt ${attempt}/${maxAttempts} ` +
              `(${result.provider}/${result.model}).`,
          );
        }
        return {
          providerUsed: result.provider,
          model: result.model,
          rawJsonText,
          parsed,
          usage: {
            inputTokens: inTok,
            outputTokens: outTok,
            attempts: attempt,
            failedInputTokens,
            failedOutputTokens,
          },
          promptVersions,
        };
      }

      // This attempt failed — its tokens are wasted spend.
      failedInputTokens += inTok;
      failedOutputTokens += outTok;
      if (budget) {
        budget.wastedTokens += inTok + outTok;
        if (
          budget.failedTokenBudget > 0 &&
          budget.wastedTokens >= budget.failedTokenBudget &&
          !budget.tripped
        ) {
          budget.tripped = true;
          this.logger.error(
            `Insights retry budget tripped: ${budget.wastedTokens} wasted tokens ` +
              `>= ${budget.failedTokenBudget}. Disabling retries for the rest of this batch.`,
          );
        }
      }

      const stop = attempt >= maxAttempts || !!budget?.tripped;
      this.logger.warn(
        `Insights extraction failed [${lastReason}] from ${result.provider}/${result.model} ` +
          `(interactionType=${interactionType}, campaign=${campaign ?? 'none'}) — ` +
          (stop ? 'no further attempts' : `retrying ${attempt}/${maxAttempts}`),
      );
      if (budget?.tripped) break;
    }

    this.logger.error(
      `Insights extraction gave up [${lastReason}] from ${lastProvider}/${lastModel} ` +
        `— raw preview:\n${lastPreview}`,
    );
    throw new BadRequestException(
      `Insights model did not return valid JSON [${lastReason}]`,
    );
  }
}
