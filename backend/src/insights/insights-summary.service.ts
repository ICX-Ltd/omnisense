import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { InsightSummary } from '../db/entities/insight-summary.entity';
import { SurveyResponse } from '../db/entities/survey-response.entity';

import { createProvider } from './providers/provider.factory';
import { SurveyAnalyticsService, buildSurveyDetail } from './survey-analytics.service';
import { PromptsService } from '../modules/prompts/prompts.service';
import { InsightsProviderName } from './types/insights-provider.type';
import { verifyCampaignQuotes } from './quote-grounding';
import { isChineseOem } from './nmgb-competitors';
import { buildInteractionQaPrompt } from './prompt/build-interaction-qa-prompt';
import {
  buildNarrativeSummaryPrompt,
  buildCallsOperationsNarrativePrompt,
  buildCallsClientServicesNarrativePrompt,
  buildChatsOperationsNarrativePrompt,
  buildChatsClientServicesNarrativePrompt,
  buildSurveyAnalyticsNarrativePrompt,
} from './prompt/build-narrative-summary-prompt';
import {
  parseNarrativeSummaryJson,
  parseAnyNarrativeJson,
  NarrativeSummary,
} from './helpers/validate-narrative-json';
import { aggregateIntoBuckets } from './helpers/objection-normalizer';
import {
  CHAT_RESPONSE_SLA_SECONDS,
  aggregateChatResponseMetrics,
  computeChatResponseMetricsFromTranscript,
} from './chat-response-time';

export interface FilterOptions {
  campaigns: string[];
  agents: string[];
  outcomes: string[];
  vehicleMakes: string[];
  // Make+model pairs so the UI can chain the model dropdown to the selected make.
  vehicleModels: { make: string; model: string }[];
}

export type InteractionFilter = 'all' | 'calls' | 'chats';
export type NarrativeType =
  | 'generic'
  | 'calls_operations'
  | 'calls_client_services'
  | 'chats_operations'
  | 'chats_client_services'
  | 'survey_analytics';

function safeParseJson(text: string): any {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

// Per-model prices in currency units per 1,000,000 tokens. Defaults are public
// list prices (USD) at time of writing; override / extend (and switch currency)
// via INSIGHTS_PRICES_JSON, e.g. {"claude-haiku-4-5":{"in":0.8,"out":4}}.
const DEFAULT_MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
  // grok pricing intentionally omitted — set it via INSIGHTS_PRICES_JSON.
};

function loadModelPrices(): Record<string, { in: number; out: number }> {
  const prices = { ...DEFAULT_MODEL_PRICES };
  const raw = process.env.INSIGHTS_PRICES_JSON;
  if (raw) {
    try {
      Object.assign(prices, JSON.parse(raw));
    } catch {
      /* ignore malformed override — fall back to defaults */
    }
  }
  return prices;
}

// Transcription is priced per audio-MINUTE. Currency unit per minute, keyed by
// the model string stored in the log. Defaults are public list prices (USD) at
// time of writing — verify against your plan and override via
// TRANSCRIPTION_PRICES_JSON, e.g. {"deepgram:nova-2-phonecall":0.0043}.
const DEFAULT_TRANSCRIPTION_PRICES: Record<string, number> = {
  'deepgram:nova-2-phonecall': 0.0058,
  'openai:gpt-4o-transcribe': 0.006,
};

function loadTranscriptionPrices(): Record<string, number> {
  const prices = { ...DEFAULT_TRANSCRIPTION_PRICES };
  const raw = process.env.TRANSCRIPTION_PRICES_JSON;
  if (raw) {
    try {
      Object.assign(prices, JSON.parse(raw));
    } catch {
      /* ignore malformed override */
    }
  }
  return prices;
}

/**
 * Simple word-overlap similarity between two strings (Jaccard on words).
 * Returns 0..1 where 1 = identical word sets.
 */
function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Merge coaching needs that are near-duplicates (>60% word overlap).
 * Keeps the label with the highest count, sums counts.
 * Returns top 10 after merging.
 */
function mergeCoachingNeeds(
  rows: Array<{ need: string; count: string }>,
): Array<{ need: string; count: number }> {
  const merged: Array<{ need: string; count: number }> = [];

  for (const row of rows) {
    const count = parseInt(row.count, 10);
    let found = false;

    for (const existing of merged) {
      if (wordSimilarity(row.need, existing.need) > 0.6) {
        existing.count += count;
        // Keep the shorter/cleaner label if counts are close, or the more common one
        if (row.need.length < existing.need.length) {
          existing.need = row.need;
        }
        found = true;
        break;
      }
    }

    if (!found) {
      merged.push({ need: row.need, count });
    }
  }

  return merged
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

@Injectable()
export class InsightsSummaryService {
  constructor(
    @InjectRepository(InteractionInsight)
    private insightsRepo: Repository<InteractionInsight>,
    @InjectRepository(Interaction)
    private recordingsRepo: Repository<Interaction>,
    @InjectRepository(InteractionTranscript)
    private transcriptsRepo: Repository<InteractionTranscript>,
    @InjectRepository(InsightSummary)
    private summariesRepo: Repository<InsightSummary>,
    @InjectRepository(SurveyResponse)
    private surveyRepo: Repository<SurveyResponse>,
    // Reused for its transcript-insight aggregation (campaign_transcript_json)
    // so the survey narrative can blend transcript signal with survey answers.
    private surveyAnalytics: SurveyAnalyticsService,
    // Supplies editable narrative-prompt fragments (keys narrative.<type>) so the
    // "Generate Narrative" flow can use prompts edited on the Prompts page.
    private prompts: PromptsService,
  ) {}

  async getFilterOptions(filterKey?: InteractionFilter): Promise<FilterOptions> {
    const applyChannel = (qb: SelectQueryBuilder<Interaction>) => {
      if (filterKey === 'calls') {
        qb.andWhere("(ia.interactionType IS NULL OR ia.interactionType = 'call')");
      } else if (filterKey === 'chats') {
        qb.andWhere("ia.interactionType = 'chat'");
      }
      return qb;
    };

    const campaigns = await applyChannel(
      this.recordingsRepo
        .createQueryBuilder('ia')
        .select('DISTINCT ia.campaign', 'campaign')
        .where('ia.campaign IS NOT NULL')
        .andWhere("ia.campaign != ''"),
    ).orderBy('ia.campaign', 'ASC').getRawMany();

    const agents = await applyChannel(
      this.recordingsRepo
        .createQueryBuilder('ia')
        .select('DISTINCT ia.agent', 'agent')
        .where('ia.agent IS NOT NULL')
        .andWhere("ia.agent != ''"),
    ).orderBy('ia.agent', 'ASC').getRawMany();

    const outcomes = await applyChannel(
      this.recordingsRepo
        .createQueryBuilder('ia')
        .select('DISTINCT ia.outcome', 'outcome')
        .where('ia.outcome IS NOT NULL')
        .andWhere("ia.outcome != ''"),
    ).orderBy('ia.outcome', 'ASC').getRawMany();

    const vehicleMakes = await applyChannel(
      this.recordingsRepo
        .createQueryBuilder('ia')
        .select('DISTINCT ia.vehicleMake', 'vehicleMake')
        .where('ia.vehicleMake IS NOT NULL')
        .andWhere("ia.vehicleMake != ''"),
    ).orderBy('ia.vehicleMake', 'ASC').getRawMany();

    // Return make+model pairs (not bare models) so the dashboard can restrict
    // the model dropdown to the models that belong to the chosen make. We fetch
    // the raw two-column rows (same shape as the makes query, plus one column)
    // and dedupe / sort in JS — a SELECT DISTINCT … ORDER BY spanning two
    // columns proved brittle across the MSSQL driver, and the row count here is
    // tiny so the JS pass is negligible.
    const vehicleModelRows = await applyChannel(
      this.recordingsRepo
        .createQueryBuilder('ia')
        .select('ia.vehicleMake', 'make')
        .addSelect('ia.vehicleModel', 'model')
        .where('ia.vehicleModel IS NOT NULL')
        .andWhere("ia.vehicleModel != ''"),
    ).getRawMany<{ make: string | null; model: string }>();

    const seenPairs = new Set<string>();
    const vehicleModels: { make: string; model: string }[] = [];
    for (const r of vehicleModelRows) {
      const make = r.make ?? '';
      const key = `${make}|${r.model}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      vehicleModels.push({ make, model: r.model });
    }
    vehicleModels.sort(
      (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model),
    );

    return {
      campaigns: campaigns.map((r) => r.campaign),
      agents: agents.map((r) => r.agent),
      outcomes: outcomes.map((r) => r.outcome),
      vehicleMakes: vehicleMakes.map((r) => r.vehicleMake),
      vehicleModels,
    };
  }

  private applyFilters<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    filterKey: string,
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string,
    vehicleModels?: string[],
  ): SelectQueryBuilder<T> {
    if (filterKey === 'calls') {
      qb.andWhere("(ia.interactionType IS NULL OR ia.interactionType = 'call')");
    } else if (filterKey === 'chats') {
      qb.andWhere("ia.interactionType = 'chat'");
    }
    if (campaign) {
      qb.andWhere('ia.campaign = :campaign', { campaign });
    }
    if (agent) {
      qb.andWhere('ia.agent = :agent', { agent });
    }
    if (excludeOutcomes?.length) {
      qb.andWhere('(ia.outcome IS NULL OR ia.outcome NOT IN (:...excludeOutcomes))', { excludeOutcomes });
    }
    if (vehicleMake) {
      qb.andWhere('ia.vehicleMake = :vehicleMake', { vehicleMake });
    }
    if (vehicleModels?.length) {
      qb.andWhere('ia.vehicleModel IN (:...vehicleModels)', { vehicleModels });
    }
    return qb;
  }

  /** Build raw SQL filter clause + extra params for direct manager.query() calls.
   *  Params @0=from, @1=to are assumed to already be in the base query;
   *  extra params are returned for appending to the params array. */
  private buildRawFilters(
    filterKey: InteractionFilter,
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string,
    vehicleModels?: string[],
  ): { clause: string; extraParams: unknown[] } {
    const parts: string[] = [];
    const extraParams: unknown[] = [];

    if (filterKey === 'calls') {
      parts.push(`(ia.interactionType IS NULL OR ia.interactionType = 'call')`);
    } else if (filterKey === 'chats') {
      parts.push(`ia.interactionType = 'chat'`);
    }

    if (campaign) {
      extraParams.push(campaign);
      parts.push(`ia.campaign = @${1 + extraParams.length}`);
    }

    if (agent) {
      extraParams.push(agent);
      parts.push(`ia.agent = @${1 + extraParams.length}`);
    }

    if (excludeOutcomes?.length) {
      const placeholders = excludeOutcomes.map((o) => {
        extraParams.push(o);
        return `@${1 + extraParams.length}`;
      });
      parts.push(`(ia.outcome IS NULL OR ia.outcome NOT IN (${placeholders.join(', ')}))`);
    }

    if (vehicleMake) {
      extraParams.push(vehicleMake);
      parts.push(`ia.vehicleMake = @${1 + extraParams.length}`);
    }

    if (vehicleModels?.length) {
      const placeholders = vehicleModels.map((m) => {
        extraParams.push(m);
        return `@${1 + extraParams.length}`;
      });
      parts.push(`ia.vehicleModel IN (${placeholders.join(', ')})`);
    }

    const clause = parts.length ? 'AND ' + parts.join(' AND ') : '';
    return { clause, extraParams };
  }

  // Monthly Operations headline trends for the sparklines on the QC dashboard.
  // One point per calendar month: volume, avg overall (QC) score, avg QA score,
  // low-score-alert count and opportunity count. Uses a rolling `monthsBack`
  // window ending at `to` — independent of the dashboard's (often day-level)
  // date filter, which would otherwise collapse to a single bucket — but honours
  // the same campaign/agent/outcome/vehicle filters so the trend tracks whatever
  // slice the dashboard is showing.
  async getOperationsMonthlyTrends(
    to: Date,
    filterKey: InteractionFilter = 'calls',
    campaign?: string, agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
    monthsBack = 12,
  ) {
    const start = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (monthsBack - 1), 1),
    );
    const { clause: filterClause, extraParams } = this.buildRawFilters(
      filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels,
    );

    const rows = await this.insightsRepo.manager.query<Array<{
      ym: string;
      total: number; scored: number;
      avg_score: number | null; avg_qa_score: number | null;
      low_score_alerts: number; opportunities: number;
    }>>(
      `SELECT
         FORMAT(COALESCE(ia.interactionDateTime, ia.createdAt), 'yyyy-MM') AS ym,
         COUNT(1) AS total,
         SUM(CASE WHEN ii.overall_score IS NOT NULL THEN 1 ELSE 0 END) AS scored,
         AVG(ii.overall_score) AS avg_score,
         AVG(CAST(JSON_VALUE(ii.qa_scores_json, '$.overall_score') AS FLOAT)) AS avg_qa_score,
         SUM(CASE WHEN ii.operations_low_score_alert = 1 THEN 1 ELSE 0 END) AS low_score_alerts,
         SUM(CASE WHEN ii.is_opportunity = 1 THEN 1 ELSE 0 END) AS opportunities
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
         AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       GROUP BY FORMAT(COALESCE(ia.interactionDateTime, ia.createdAt), 'yyyy-MM')`,
      [start, to, ...extraParams],
    );

    const byMonth = new Map(rows.map((r) => [r.ym, r]));
    const months: string[] = [];
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    const round1 = (v: number | null | undefined) =>
      v == null ? null : Math.round(Number(v) * 10) / 10;
    const num = (v: unknown) => Number(v) || 0;
    const at = (m: string) => byMonth.get(m);

    return {
      months,
      total: months.map((m) => num(at(m)?.total)),
      scored: months.map((m) => num(at(m)?.scored)),
      avg_score: months.map((m) => round1(at(m)?.avg_score)),
      avg_qa_score: months.map((m) => round1(at(m)?.avg_qa_score)),
      low_score_alerts: months.map((m) => num(at(m)?.low_score_alerts)),
      opportunities: months.map((m) => num(at(m)?.opportunities)),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERAL METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getMetricsSummary(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[], vehicleMake?: string, vehicleModels?: string[]) {
    const dateWhere = 'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };

    const baseQb = () =>
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams);

    const totals = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select('COUNT(1)', 'total_calls')
      .addSelect('AVG(ii.sentiment_overall)', 'avg_sentiment')
      .getRawOne<{ total_calls: string; avg_sentiment: number | null }>();

    const byCampaign = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ii.campaign_detected, 'unknown')", 'campaign_detected')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.campaign_detected, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ campaign_detected: string; count: string }>();

    const byScore = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select('AVG(ii.overall_score)', 'avg_score')
      .addSelect('MIN(ii.overall_score)', 'min_score')
      .addSelect('MAX(ii.overall_score)', 'max_score')
      .andWhere('ii.overall_score IS NOT NULL')
      .getRawOne<{ avg_score: number | null; min_score: number | null; max_score: number | null }>();

    const connectedDispositionFilter = `ii.contact_disposition NOT IN ('no_answer', 'voicemail', 'busy', 'call_dropped', 'invalid_number')`;

    const worstSentiment = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        'ii.contact_disposition AS contact_disposition',
        'ii.campaign_detected AS campaign_detected',
        'ii.sentiment_overall AS sentiment_overall',
      ])
      .andWhere('ii.sentiment_overall IS NOT NULL')
      .andWhere(connectedDispositionFilter)
      .orderBy('ii.sentiment_overall', 'ASC')
      .limit(5)
      .getRawMany();

    const byContact = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select(
        "COALESCE(ii.contact_disposition, 'unknown')",
        'contact_disposition',
      )
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.contact_disposition, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ contact_disposition: string; count: string }>();

    const byConversationType = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ii.conversation_type, 'unknown')", 'conversation_type')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.conversation_type, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ conversation_type: string; count: string }>();

    const byInterest = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ii.interest_level, 'unknown')", 'interest_level')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.interest_level, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ interest_level: string; count: string }>();

    const leadGenerated = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select(
        'SUM(CASE WHEN ii.lead_generated_for_dealer = 1 THEN 1 ELSE 0 END)',
        'count_true',
      )
      .addSelect('COUNT(1)', 'total')
      .getRawOne<{ count_true: string; total: string }>();

    const bestSentiment = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        'ii.contact_disposition AS contact_disposition',
        'ii.campaign_detected AS campaign_detected',
        'ii.sentiment_overall AS sentiment_overall',
      ])
      .andWhere('ii.sentiment_overall IS NOT NULL')
      .andWhere(connectedDispositionFilter)
      .orderBy('ii.sentiment_overall', 'DESC')
      .limit(5)
      .getRawMany();

    const dealerFollowups = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        "COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name) AS dealer_name",
        "CASE WHEN NULLIF(ia.dealer, '') IS NULL THEN 1 ELSE 0 END AS dealer_inferred",
        'ii.campaign_detected AS campaign_detected',
      ])
      .andWhere('ii.lead_generated_for_dealer = 1')
      .orderBy('COALESCE(ia.interactionDateTime, ia.createdAt)', 'DESC')
      .limit(5)
      .getRawMany();

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      totals: {
        total_calls: parseInt(totals?.total_calls ?? '0', 10),
        avg_sentiment: totals?.avg_sentiment ?? null,
      },
      by_campaign: byCampaign.map((r) => ({
        campaign_detected: r.campaign_detected,
        count: parseInt(r.count, 10),
      })),
      scores: {
        avg_score: byScore?.avg_score ?? null,
        min_score: byScore?.min_score ?? null,
        max_score: byScore?.max_score ?? null,
      },
      by_contact: byContact.map((r) => ({
        contact_disposition: r.contact_disposition,
        count: parseInt(r.count, 10),
      })),
      by_conversation_type: byConversationType.map((r) => ({
        conversation_type: r.conversation_type,
        count: parseInt(r.count, 10),
      })),
      by_interest: byInterest.map((r) => ({
        interest_level: r.interest_level,
        count: parseInt(r.count, 10),
      })),
      lead_generated: {
        count_true: parseInt(leadGenerated?.count_true ?? '0', 10),
        total: parseInt(leadGenerated?.total ?? '0', 10),
      },
      examples: {
        worst_sentiment: worstSentiment,
        best_sentiment: bestSentiment,
        dealer_followups: dealerFollowups,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPERATIONS METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getOperationsMetrics(
    from: Date, to: Date,
    filterKey: InteractionFilter = 'calls',
    campaign?: string, agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
    excludePartial = false,
  ) {
    const dateWhere = 'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);

    const baseQb = () =>
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams);

    const scoreStats = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select('AVG(ii.overall_score)', 'avg_score')
      .addSelect('MIN(ii.overall_score)', 'min_score')
      .addSelect('MAX(ii.overall_score)', 'max_score')
      .addSelect('SUM(CASE WHEN ii.overall_score IS NOT NULL THEN 1 ELSE 0 END)', 'scored_count')
      .addSelect('COUNT(1)', 'total_count')
      .getRawOne<{ avg_score: number | null; min_score: number | null; max_score: number | null; scored_count: string; total_count: string }>();

    // QA overall-score stats (from qa_assessment.overall_score inside qa_scores_json)
    const qaScoreStats = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("AVG(CAST(JSON_VALUE(ii.qa_scores_json, '$.overall_score') AS FLOAT))", 'avg_score')
      .addSelect("MIN(CAST(JSON_VALUE(ii.qa_scores_json, '$.overall_score') AS FLOAT))", 'min_score')
      .addSelect("MAX(CAST(JSON_VALUE(ii.qa_scores_json, '$.overall_score') AS FLOAT))", 'max_score')
      .addSelect(
        "SUM(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.overall_score') IS NOT NULL THEN 1 ELSE 0 END)",
        'scored_count',
      )
      .andWhere('ii.qa_scores_json IS NOT NULL')
      .getRawOne<{ avg_score: number | null; min_score: number | null; max_score: number | null; scored_count: string }>();

    const scoreBuckets = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select(
        `CASE WHEN ii.overall_score < 5 THEN 'below_5' WHEN ii.overall_score < 7 THEN '5_to_7' WHEN ii.overall_score < 9 THEN '7_to_9' ELSE '9_plus' END`,
        'bucket',
      )
      .addSelect('COUNT(1)', 'count')
      .andWhere('ii.overall_score IS NOT NULL')
      .groupBy(`CASE WHEN ii.overall_score < 5 THEN 'below_5' WHEN ii.overall_score < 7 THEN '5_to_7' WHEN ii.overall_score < 9 THEN '7_to_9' ELSE '9_plus' END`)
      .getRawMany<{ bucket: string; count: string }>();

    // Per-dimension averages using JSON_VALUE (calls + chats).
    // Partial-exclusion check falls back to reading scoring_flags from the raw
    // LLM JSON so it still works for records that predate the indexed bit column.
    // ISJSON guard skips rows whose raw JSON is malformed (e.g. legacy rows
    // stored with markdown fences) — those records are treated as "not partial"
    // rather than erroring the whole query.
    const partialClause = excludePartial
      ? `AND (
          ii.operations_partial_scoring = 0
          OR (
            ii.operations_partial_scoring IS NULL
            AND (
              ii.json IS NULL
              OR ISJSON(ii.json) = 0
              OR JSON_VALUE(ii.json, '$.operations.scoring_flags.partial_scoring') IS NULL
              OR JSON_VALUE(ii.json, '$.operations.scoring_flags.partial_scoring') <> 'true'
            )
          )
        )`
      : '';
    const dimScores = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
      `SELECT
        -- Call dimensions
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.intro.score') AS FLOAT)) AS intro,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.data_protection.score') AS FLOAT)) AS data_protection,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.campaign_focus.score') AS FLOAT)) AS campaign_focus,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.disclaimer.score') AS FLOAT)) AS disclaimer,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.gdpr.score') AS FLOAT)) AS gdpr,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.correct_outcome.score') AS FLOAT)) AS correct_outcome,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.tone_pace.score') AS FLOAT)) AS tone_pace,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.delivery.score') AS FLOAT)) AS delivery,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.questioning.score') AS FLOAT)) AS questioning,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.rapport.score') AS FLOAT)) AS rapport,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.objection_handling.score') AS FLOAT)) AS objection_handling,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.active_listening.score') AS FLOAT)) AS active_listening,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.product_knowledge.score') AS FLOAT)) AS product_knowledge,
        -- Chat dimensions
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.response_time.score') AS FLOAT)) AS response_time,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.accept_time.score') AS FLOAT)) AS accept_time,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.product_process.score') AS FLOAT)) AS product_process,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.engagement.score') AS FLOAT)) AS engagement,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.tone.score') AS FLOAT)) AS tone,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.paraphrase_close.score') AS FLOAT)) AS paraphrase_close,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.language_accuracy.score') AS FLOAT)) AS language_accuracy,
        AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.contact_details.score') AS FLOAT)) AS contact_details
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE ii.operations_scores_json IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}
        ${partialClause}`,
      [from, to, ...extraParams],
    );

    // Helper — a SQL fragment that evaluates to true for rows where the given
    // flag (column + JSON fallback) is set. `flagColumn` is the bit column
    // name, `jsonPath` is the JSON_VALUE path.
    const flagIsTrueSql = (flagColumn: string, jsonPath: string) => `(
      ii.${flagColumn} = 1
      OR (
        ii.${flagColumn} IS NULL
        AND ISJSON(ii.json) = 1
        AND JSON_VALUE(ii.json, '${jsonPath}') = 'true'
      )
    )`;

    // Partial scores grouped by outcome — one aggregation per layer.
    const partialByOutcomeOps = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ia.outcome, 'unknown')", 'outcome')
      .addSelect('COUNT(1)', 'count')
      .andWhere(flagIsTrueSql('operations_partial_scoring', '$.operations.scoring_flags.partial_scoring'))
      .groupBy("COALESCE(ia.outcome, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ outcome: string; count: string }>();

    const partialByOutcomeQa = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ia.outcome, 'unknown')", 'outcome')
      .addSelect('COUNT(1)', 'count')
      .andWhere(flagIsTrueSql('qa_partial_scoring', '$.qa_assessment.scoring_flags.partial_scoring'))
      .groupBy("COALESCE(ia.outcome, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ outcome: string; count: string }>();

    // Low-score alerts grouped by agent — one aggregation per layer. Null or
    // empty agents bucketed as "unknown".
    const lowScoreByAgentOps = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(NULLIF(ia.agent, ''), 'unknown')", 'agent')
      .addSelect('COUNT(1)', 'count')
      .addSelect('AVG(ii.overall_score)', 'avg_score')
      .andWhere(flagIsTrueSql('operations_low_score_alert', '$.operations.scoring_flags.low_score_alert'))
      .groupBy("COALESCE(NULLIF(ia.agent, ''), 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ agent: string; count: string; avg_score: number | null }>();

    const lowScoreByAgentQa = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(NULLIF(ia.agent, ''), 'unknown')", 'agent')
      .addSelect('COUNT(1)', 'count')
      .addSelect('AVG(ii.overall_score)', 'avg_score')
      .andWhere(flagIsTrueSql('qa_low_score_alert', '$.qa_assessment.scoring_flags.low_score_alert'))
      .groupBy("COALESCE(NULLIF(ia.agent, ''), 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ agent: string; count: string; avg_score: number | null }>();

    // Flag counts — split by layer (operations vs QA) to avoid visual overlap
    const flagCounts = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select(
        'SUM(CASE WHEN ii.operations_partial_scoring = 1 THEN 1 ELSE 0 END)',
        'ops_partial_count',
      )
      .addSelect(
        'SUM(CASE WHEN ii.operations_low_score_alert = 1 THEN 1 ELSE 0 END)',
        'ops_low_score_count',
      )
      .addSelect(
        'SUM(CASE WHEN ii.qa_partial_scoring = 1 THEN 1 ELSE 0 END)',
        'qa_partial_count',
      )
      .addSelect(
        'SUM(CASE WHEN ii.qa_low_score_alert = 1 THEN 1 ELSE 0 END)',
        'qa_low_score_count',
      )
      .getRawOne<{
        ops_partial_count: string | null;
        ops_low_score_count: string | null;
        qa_partial_count: string | null;
        qa_low_score_count: string | null;
      }>();

    // Top coaching needs via OPENJSON — normalise text (lowercase, trim, strip trailing punctuation)
    // then merge similar entries in TS
    const rawCoachingNeeds = await this.insightsRepo.manager.query<Array<{ need: string; count: string }>>(
      `SELECT TOP 30 LOWER(LTRIM(RTRIM(
          REPLACE(REPLACE(REPLACE(j.value, '.', ''), '!', ''), ',', '')
        ))) AS need, COUNT(*) AS count
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      CROSS APPLY OPENJSON(ii.coaching_json, '$.needs_improvement') j
      WHERE ii.coaching_json IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}
        AND LOWER(LTRIM(RTRIM(j.value))) NOT IN (
          'none', 'none noted', 'n/a', 'not applicable', 'nothing noted',
          'nothing to note', 'no issues', 'no issues noted', 'no improvements needed',
          'none identified', 'not noted', 'none observed'
        )
        AND LEN(LTRIM(RTRIM(j.value))) > 3
      GROUP BY LOWER(LTRIM(RTRIM(
          REPLACE(REPLACE(REPLACE(j.value, '.', ''), '!', ''), ',', '')
        )))
      ORDER BY COUNT(*) DESC`,
      [from, to, ...extraParams],
    );

    const topCoachingNeeds = mergeCoachingNeeds(rawCoachingNeeds);

    const outcomeDistribution = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ia.outcome, 'unknown')", 'outcome')
      .addSelect('COUNT(1)', 'count')
      .addSelect('AVG(ii.overall_score)', 'avg_score')
      .groupBy("COALESCE(ia.outcome, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ outcome: string; count: string; avg_score: number | null }>();

    const lowestScored = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        'ii.overall_score AS overall_score',
        'ii.coaching_json AS coaching_json',
        'ii.campaign_detected AS campaign_detected',
      ])
      .andWhere('ii.overall_score IS NOT NULL')
      .andWhere(`ii.contact_disposition NOT IN ('no_answer', 'voicemail', 'busy', 'call_dropped', 'invalid_number')`)
      .orderBy('ii.overall_score', 'ASC')
      .limit(5)
      .getRawMany();

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      score_stats: {
        avg_score: scoreStats?.avg_score ?? null,
        min_score: scoreStats?.min_score ?? null,
        max_score: scoreStats?.max_score ?? null,
        scored_count: parseInt(scoreStats?.scored_count ?? '0', 10),
        total_count: parseInt(scoreStats?.total_count ?? '0', 10),
      },
      qa_score_stats: {
        avg_score: qaScoreStats?.avg_score ?? null,
        min_score: qaScoreStats?.min_score ?? null,
        max_score: qaScoreStats?.max_score ?? null,
        scored_count: parseInt(qaScoreStats?.scored_count ?? '0', 10),
      },
      score_distribution: scoreBuckets.map((r) => ({
        bucket: r.bucket,
        count: parseInt(r.count, 10),
      })),
      outcome_distribution: outcomeDistribution.map((r) => ({
        outcome: r.outcome,
        count: parseInt(r.count, 10),
        avg_score: r.avg_score ?? null,
      })),
      dimension_averages: dimScores[0] ?? {},
      dimension_averages_exclude_partial: excludePartial,
      scoring_flags: {
        ops_partial_count: parseInt(flagCounts?.ops_partial_count ?? '0', 10),
        ops_low_score_count: parseInt(flagCounts?.ops_low_score_count ?? '0', 10),
        qa_partial_count: parseInt(flagCounts?.qa_partial_count ?? '0', 10),
        qa_low_score_count: parseInt(flagCounts?.qa_low_score_count ?? '0', 10),
      },
      partial_by_outcome_ops: partialByOutcomeOps.map((r) => ({
        outcome: r.outcome,
        count: parseInt(r.count, 10),
      })),
      partial_by_outcome_qa: partialByOutcomeQa.map((r) => ({
        outcome: r.outcome,
        count: parseInt(r.count, 10),
      })),
      low_score_by_agent_ops: lowScoreByAgentOps.map((r) => ({
        agent: r.agent,
        count: parseInt(r.count, 10),
        avg_score: r.avg_score ?? null,
      })),
      low_score_by_agent_qa: lowScoreByAgentQa.map((r) => ({
        agent: r.agent,
        count: parseInt(r.count, 10),
        avg_score: r.avg_score ?? null,
      })),
      top_coaching_needs: topCoachingNeeds,
      lowest_scored: lowestScored.map((r) => ({
        ...r,
        coaching_json: r.coaching_json ? safeParseJson(r.coaching_json as string) : null,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CHAT RESPONSE-TIME METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  // Re-exposed from the chat-response-time module so the summary endpoint
  // can advertise the active SLA threshold to the dashboard.
  private readonly CHAT_RESPONSE_SLA_SECONDS = CHAT_RESPONSE_SLA_SECONDS;

  async getChatResponseTimeMetrics(
    from: Date,
    to: Date,
    filterKey: InteractionFilter = 'chats',
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const dateWhere =
      'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };

    const baseQb = () =>
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams)
        .andWhere('ii.chat_response_measured_count IS NOT NULL');

    // Aggregate summary block — reused for the agent-filtered figures and the
    // all-agents comparison baseline.
    const summaryFor = async (agentFilter: string | undefined) => {
      const totals = await this.applyFilters(
        baseQb(),
        filterKey,
        campaign,
        agentFilter,
        excludeOutcomes,
      )
        .select('COUNT(1)', 'chats_measured')
        .addSelect('AVG(ii.chat_response_avg_seconds)', 'avg_response_seconds')
        .addSelect('AVG(ii.chat_response_last_seconds)', 'avg_last_response_seconds')
        .addSelect('MAX(ii.chat_response_longest_seconds)', 'max_longest_seconds')
        .addSelect('SUM(ii.chat_response_sla_breach_count)', 'sla_breach_total')
        .addSelect('SUM(ii.chat_response_measured_count)', 'pairs_measured_total')
        .addSelect(
          'SUM(CASE WHEN ii.chat_response_sla_breach_count > 0 THEN 1 ELSE 0 END)',
          'chats_with_breach',
        )
        .getRawOne<{
          chats_measured: string | null;
          avg_response_seconds: number | null;
          avg_last_response_seconds: number | null;
          max_longest_seconds: number | null;
          sla_breach_total: string | null;
          pairs_measured_total: string | null;
          chats_with_breach: string | null;
        }>();

      const chatsMeasured = parseInt(totals?.chats_measured ?? '0', 10);
      const slaBreachTotal = parseInt(totals?.sla_breach_total ?? '0', 10);
      const pairsMeasuredTotal = parseInt(totals?.pairs_measured_total ?? '0', 10);
      const chatsWithBreach = parseInt(totals?.chats_with_breach ?? '0', 10);

      return {
        chats_measured: chatsMeasured,
        avg_response_seconds: totals?.avg_response_seconds ?? null,
        avg_last_response_seconds: totals?.avg_last_response_seconds ?? null,
        max_longest_seconds: totals?.max_longest_seconds ?? null,
        sla_breach_total: slaBreachTotal,
        pairs_measured_total: pairsMeasuredTotal,
        chats_with_breach: chatsWithBreach,
        sla_breach_rate:
          pairsMeasuredTotal > 0 ? slaBreachTotal / pairsMeasuredTotal : null,
      };
    };

    const summary = await summaryFor(agent);
    // When the caller scoped to a single agent, also compute the all-agents
    // baseline so the UI can render comparison figures alongside.
    const comparisonSummary = agent ? await summaryFor(undefined) : null;

    // Always the full cross-agent leaderboard — deliberately NOT filtered by the
    // selected `agent` so the UI can show the ranking (and where the picked agent
    // sits) even after the user drills into one agent.
    const worstByAgent = await this.applyFilters(
      baseQb(),
      filterKey,
      campaign,
      undefined,
      excludeOutcomes,
    )
      .select("COALESCE(NULLIF(ia.agent, ''), 'unknown')", 'agent')
      .addSelect('COUNT(1)', 'chats')
      .addSelect('AVG(ii.chat_response_avg_seconds)', 'avg_response_seconds')
      .addSelect('SUM(ii.chat_response_sla_breach_count)', 'sla_breach_count')
      .addSelect('MAX(ii.chat_response_longest_seconds)', 'max_longest_seconds')
      .groupBy("COALESCE(NULLIF(ia.agent, ''), 'unknown')")
      .orderBy('sla_breach_count', 'DESC')
      .addOrderBy('avg_response_seconds', 'DESC')
      .limit(10)
      .getRawMany<{
        agent: string;
        chats: string;
        avg_response_seconds: number | null;
        sla_breach_count: string | null;
        max_longest_seconds: number | null;
      }>();

    const slowestChats = await this.applyFilters(
      baseQb(),
      filterKey,
      campaign,
      agent,
      excludeOutcomes,
    )
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        'ia.agent AS agent',
        'ia.campaign AS campaign',
        'ii.chat_response_avg_seconds AS avg_seconds',
        'ii.chat_response_longest_seconds AS longest_seconds',
        'ii.chat_response_last_seconds AS last_seconds',
        'ii.chat_response_sla_breach_count AS sla_breach_count',
      ])
      .andWhere('ii.chat_response_longest_seconds IS NOT NULL')
      .orderBy('ii.chat_response_longest_seconds', 'DESC')
      .limit(10)
      .getRawMany();

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      sla_threshold_seconds: this.CHAT_RESPONSE_SLA_SECONDS,
      agent: agent ?? null,
      summary,
      // Populated only when an agent filter is in effect — contains the same
      // summary shape computed across ALL agents in the same window so the UI
      // can render the agent vs. baseline comparison.
      comparison: comparisonSummary
        ? { scope: 'all_agents', summary: comparisonSummary }
        : null,
      worst_by_agent: worstByAgent.map((r) => ({
        agent: r.agent,
        chats: parseInt(r.chats, 10),
        avg_response_seconds: r.avg_response_seconds ?? null,
        sla_breach_count: parseInt(r.sla_breach_count ?? '0', 10),
        max_longest_seconds: r.max_longest_seconds ?? null,
      })),
      slowest_chats: slowestChats,
    };
  }

  // Recomputes chat response-time metrics from the stored transcript for
  // every chat in the supplied filter window. Always overwrites the existing
  // metrics — the LLM outputs were unreliable so backend code is canonical.
  async recomputeChatResponseTimeMetrics(
    from: Date,
    to: Date,
    filterKey: InteractionFilter = 'chats',
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    // We always operate on chats — calls have no per-message timestamps to
    // measure. Honour the user's filterKey but coerce 'calls' to 'chats'
    // (and 'all' down-narrows to chats by virtue of the chat-only filter
    // below).
    const effectiveFilter: InteractionFilter =
      filterKey === 'calls' ? 'chats' : filterKey;

    const dateWhere =
      'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };

    // Match the chats by joining interaction → insight via the standard
    // filter helpers, then narrow to chats only.
    const qb = this.applyFilters(
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams)
        .andWhere("ia.interactionType = 'chat'"),
      effectiveFilter,
      campaign,
      agent,
      excludeOutcomes,
    )
      .select([
        'ii.recordingId AS recordingId',
        'ia.campaign AS campaign',
      ]);

    const rows = await qb.getRawMany<{
      recordingId: string;
      campaign: string | null;
    }>();

    let processed = 0;
    let skipped = 0;
    let errored = 0;
    const errors: Array<{ recordingId: string; message: string }> = [];

    for (const row of rows) {
      try {
        const transcript = await this.transcriptsRepo.findOne({
          where: { recordingId: row.recordingId },
        });
        if (!transcript?.text?.trim()) {
          skipped++;
          continue;
        }

        const metrics = computeChatResponseMetricsFromTranscript(
          transcript.text,
          row.campaign,
        );
        const agg = aggregateChatResponseMetrics(metrics);

        await this.insightsRepo.update(
          { recordingId: row.recordingId },
          {
            chat_response_avg_seconds: agg.avgSeconds,
            chat_response_longest_seconds: agg.longestSeconds,
            chat_response_last_seconds: agg.lastSeconds,
            chat_response_sla_breach_count: agg.slaBreachCount,
            chat_response_measured_count: agg.measuredCount,
            chat_response_metrics_json: JSON.stringify(metrics),
          },
        );

        processed++;
      } catch (e: any) {
        errored++;
        errors.push({
          recordingId: row.recordingId,
          message: e?.message ?? String(e),
        });
      }
    }

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: effectiveFilter,
      candidates: rows.length,
      processed,
      skipped,
      errored,
      errors: errors.slice(0, 25),
      sla_threshold_seconds: this.CHAT_RESPONSE_SLA_SECONDS,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CLIENT SERVICES METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getClientServicesMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[], vehicleMake?: string, vehicleModels?: string[]) {
    const dateWhere = 'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);

    const baseQb = () =>
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams);

    const scalars = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select('COUNT(1)', 'total')
      .addSelect('SUM(CASE WHEN ii.lead_generated_for_dealer = 1 THEN 1 ELSE 0 END)', 'leads')
      .addSelect('SUM(CASE WHEN ii.is_in_market_now = 1 THEN 1 ELSE 0 END)', 'in_market')
      .addSelect('SUM(CASE WHEN ii.lost_sale = 1 THEN 1 ELSE 0 END)', 'lost_sales')
      .addSelect('SUM(CASE WHEN ii.has_purchased_elsewhere = 1 THEN 1 ELSE 0 END)', 'purchased_elsewhere')
      .getRawOne<{ total: string; leads: string; in_market: string; lost_sales: string; purchased_elsewhere: string }>();

    const topCompetitors = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ii.competitor_purchased, 'unknown')", 'competitor')
      .addSelect('COUNT(1)', 'count')
      .andWhere('ii.has_purchased_elsewhere = 1')
      .groupBy("COALESCE(ii.competitor_purchased, 'unknown')")
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ competitor: string; count: string }>();

    // Top 3 objections for each competitor purchase — OPENJSON + ROW_NUMBER window
    const competitorObjections = await this.insightsRepo.manager.query<
      Array<{ competitor: string; objection: string; obj_count: string }>
    >(
      `SELECT competitor, objection, obj_count
      FROM (
        SELECT
          ii.competitor_purchased AS competitor,
          j.value AS objection,
          COUNT(*) AS obj_count,
          ROW_NUMBER() OVER (PARTITION BY ii.competitor_purchased ORDER BY COUNT(*) DESC) AS rn
        FROM app.interaction_insights ii
        INNER JOIN app.interactions ia ON ia.id = ii.recordingId
        CROSS APPLY OPENJSON(ii.objections_json) j
        WHERE ii.has_purchased_elsewhere = 1
          AND ii.competitor_purchased IS NOT NULL
          AND ii.objections_json IS NOT NULL
          AND ii.objections_json != '[]'
          AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
          AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
          ${filterClause}
        GROUP BY ii.competitor_purchased, j.value
      ) ranked
      WHERE rn <= 3
      ORDER BY competitor, rn`,
      [from, to, ...extraParams],
    );

    const topDealers = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name, 'unknown')", 'dealer_name')
      .addSelect('COUNT(1)', 'count')
      .andWhere('ii.lead_generated_for_dealer = 1')
      .groupBy("COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name, 'unknown')")
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ dealer_name: string; count: string }>();

    const byInterest = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ii.interest_level, 'unknown')", 'interest_level')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.interest_level, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ interest_level: string; count: string }>();

    const byOutcome = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ia.outcome, 'unknown')", 'outcome')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ia.outcome, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ outcome: string; count: string }>();

    const byVehicleMake = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select("COALESCE(ia.vehicleMake, 'unknown')", 'vehicle_make')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ia.vehicleMake, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ vehicle_make: string; count: string }>();

    const recentLostSales = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels)
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        'ii.competitor_purchased AS competitor_purchased',
        "COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name) AS dealer_name",
        "CASE WHEN NULLIF(ia.dealer, '') IS NULL THEN 1 ELSE 0 END AS dealer_inferred",
        'ii.campaign_detected AS campaign_detected',
        'COALESCE(ia.interactionDateTime, ia.createdAt) AS interactionDateTime',
      ])
      .andWhere('ii.lost_sale = 1')
      .orderBy('COALESCE(ia.interactionDateTime, ia.createdAt)', 'DESC')
      .limit(5)
      .getRawMany();

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      totals: {
        total: parseInt(scalars?.total ?? '0', 10),
        leads: parseInt(scalars?.leads ?? '0', 10),
        in_market: parseInt(scalars?.in_market ?? '0', 10),
        lost_sales: parseInt(scalars?.lost_sales ?? '0', 10),
        purchased_elsewhere: parseInt(scalars?.purchased_elsewhere ?? '0', 10),
      },
      by_interest: byInterest.map((r) => ({
        interest_level: r.interest_level,
        count: parseInt(r.count, 10),
      })),
      by_outcome: byOutcome.map((r) => ({
        outcome: r.outcome,
        count: parseInt(r.count, 10),
      })),
      by_vehicle_make: byVehicleMake.map((r) => ({
        vehicle_make: r.vehicle_make,
        count: parseInt(r.count, 10),
      })),
      top_competitors: (() => {
        const objMap = new Map<string, Array<{ objection: string; count: number }>>();
        for (const row of competitorObjections) {
          if (!objMap.has(row.competitor)) objMap.set(row.competitor, []);
          objMap.get(row.competitor)!.push({ objection: row.objection, count: parseInt(row.obj_count, 10) });
        }
        return topCompetitors.map((r) => ({
          competitor: r.competitor,
          count: parseInt(r.count, 10),
          top_objections: objMap.get(r.competitor) ?? [],
        }));
      })(),
      top_dealers: topDealers.map((r) => ({
        dealer_name: r.dealer_name,
        count: parseInt(r.count, 10),
      })),
      recent_lost_sales: recentLostSales,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OBJECTIONS METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getObjectionsMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[], vehicleMake?: string, vehicleModels?: string[]) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);

    // Fetch all raw objection strings with occurrence counts — normalisation happens in TS
    const rawObjections = await this.insightsRepo.manager.query<Array<{ objection: string; count: string }>>(
      `SELECT j.value AS objection, COUNT(*) AS count
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      CROSS APPLY OPENJSON(ii.objections_json) j
      WHERE ii.objections_json IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}
      GROUP BY j.value`,
      [from, to, ...extraParams],
    );

    const summary = await this.insightsRepo.manager.query<Array<{ total: string; with_objections: string }>>(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN ii.objections_json IS NOT NULL AND ii.objections_json != '[]' THEN 1 ELSE 0 END) AS with_objections
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}`,
      [from, to, ...extraParams],
    );

    const s = summary[0] ?? { total: '0', with_objections: '0' };

    const bucketed = aggregateIntoBuckets(
      rawObjections.map((r) => ({ raw: r.objection, count: parseInt(r.count, 10) })),
    );

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      totals: {
        total: parseInt(s.total, 10),
        with_objections: parseInt(s.with_objections, 10),
      },
      top_objections: bucketed,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OBJECTION ASSESSMENT METRICS (campaign-specific detailed evaluation)
  // ─────────────────────────────────────────────────────────────────────────────

  private static readonly OBJECTION_CATEGORIES = [
    'price_value', 'incentive_offer', 'time_delay', 'think_about_it_consult',
    'channel_preference', 'post_link_drop_off', 'technical_issues',
    'future_purchase_intent', 'independent_customer', 'confusion_validation',
    'low_engagement', 'product_policy_fit', 'effort_process_friction',
  ] as const;

  private static readonly CHECKLIST_ITEMS = [
    'acknowledged_concern', 'clarified_reason', 'reframed_value',
    'offered_solution', 'maintained_control', 'progressed_next_step',
  ] as const;

  private aggregateObjectionAssessments(rows: Array<{ assessment: string }>) {
    const categoryStats: Record<string, { raised: number; best_practice: number; could_do_more: number; total_raised: number }> = {};
    for (const cat of InsightsSummaryService.OBJECTION_CATEGORIES) {
      categoryStats[cat] = { raised: 0, best_practice: 0, could_do_more: 0, total_raised: 0 };
    }

    const checklistStats: Record<string, { yes: number; total: number }> = {};
    for (const item of InsightsSummaryService.CHECKLIST_ITEMS) {
      checklistStats[item] = { yes: 0, total: 0 };
    }

    let totalAssessed = 0;
    let totalWithObjections = 0;
    let totalObjectionsRaised = 0;
    let checklistScoreSum = 0;
    let checklistScoreCount = 0;

    for (const row of rows) {
      let assessment: any;
      try { assessment = typeof row.assessment === 'string' ? JSON.parse(row.assessment) : row.assessment; } catch { continue; }
      if (!assessment?.categories) continue;

      totalAssessed++;
      let anyRaised = false;

      for (const cat of InsightsSummaryService.OBJECTION_CATEGORIES) {
        const entry = assessment.categories[cat];
        if (!entry) continue;
        if (entry.raised) {
          categoryStats[cat].raised++;
          categoryStats[cat].total_raised++;
          anyRaised = true;
          if (entry.best_practice_followed === true) categoryStats[cat].best_practice++;
          if (entry.could_do_more === true) categoryStats[cat].could_do_more++;
        }
      }

      if (anyRaised) totalWithObjections++;
      totalObjectionsRaised += assessment.objections_raised_count ?? 0;

      if (assessment.generic_checklist) {
        for (const item of InsightsSummaryService.CHECKLIST_ITEMS) {
          const val = assessment.generic_checklist[item];
          if (val !== null && val !== undefined) {
            checklistStats[item].total++;
            if (val === true) checklistStats[item].yes++;
          }
        }
      }

      if (typeof assessment.checklist_score === 'number') {
        checklistScoreSum += assessment.checklist_score;
        checklistScoreCount++;
      }
    }

    return {
      totals: {
        assessed: totalAssessed,
        with_objections: totalWithObjections,
        total_objections_raised: totalObjectionsRaised,
        avg_checklist_score: checklistScoreCount > 0
          ? Math.round((checklistScoreSum / checklistScoreCount) * 100) / 100
          : null,
      },
      categories: InsightsSummaryService.OBJECTION_CATEGORIES.map((cat) => ({
        category: cat,
        raised_count: categoryStats[cat].raised,
        best_practice_count: categoryStats[cat].best_practice,
        could_do_more_count: categoryStats[cat].could_do_more,
        best_practice_rate: categoryStats[cat].total_raised > 0
          ? Math.round((categoryStats[cat].best_practice / categoryStats[cat].total_raised) * 100) / 100
          : null,
      })),
      checklist: InsightsSummaryService.CHECKLIST_ITEMS.map((item) => ({
        item,
        yes_count: checklistStats[item].yes,
        total: checklistStats[item].total,
        rate: checklistStats[item].total > 0
          ? Math.round((checklistStats[item].yes / checklistStats[item].total) * 100) / 100
          : null,
      })),
    };
  }

  private buildObjectionAssessmentSql(filterClause: string, oppClause: string) {
    return `SELECT ii.objection_assessments_json AS assessment
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE ii.objection_assessments_json IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
        AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${oppClause}
        ${filterClause}`;
  }

  async getObjectionAssessmentMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'chats', campaign?: string, agent?: string, excludeOutcomes?: string[], vehicleMake?: string, vehicleModels?: string[], opportunitiesOnly = false) {
    const oppClause = opportunitiesOnly ? 'AND (ii.is_opportunity = 1 OR ii.is_opportunity IS NULL)' : '';

    // Always compute overall (no agent filter)
    const { clause: overallClause, extraParams: overallParams } = this.buildRawFilters(filterKey, campaign, undefined, excludeOutcomes, vehicleMake, vehicleModels);
    const overallRows = await this.insightsRepo.manager.query<Array<{ assessment: string }>>(
      this.buildObjectionAssessmentSql(overallClause, oppClause),
      [from, to, ...overallParams],
    );
    const overall = this.aggregateObjectionAssessments(overallRows);

    // If agent is specified, also compute agent-specific
    let agentResult: ReturnType<typeof this.aggregateObjectionAssessments> | null = null;
    if (agent) {
      const { clause: agentClause, extraParams: agentParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
      const agentRows = await this.insightsRepo.manager.query<Array<{ assessment: string }>>(
        this.buildObjectionAssessmentSql(agentClause, oppClause),
        [from, to, ...agentParams],
      );
      agentResult = this.aggregateObjectionAssessments(agentRows);
    }

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      agentName: agent ?? null,
      ...overall,
      agent: agentResult,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: INTERACTIONS BY OBJECTION CATEGORY
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByObjectionCategory(
    from: Date, to: Date, filterKey: InteractionFilter = 'chats',
    category: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[], vehicleMake?: string, vehicleModels?: string[], opportunitiesOnly = false,
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;
    const oppClause = opportunitiesOnly ? 'AND (ii.is_opportunity = 1 OR ii.is_opportunity IS NULL)' : '';

    const safeCategory = category.replace(/[^a-z_]/g, '');

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.objection_assessments_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId, ia.interactionId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ii.objection_assessments_json IS NOT NULL
         AND JSON_VALUE(ii.objection_assessments_json, '$.categories.${safeCategory}.raised') = 'true'
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${oppClause}
         ${filterClause}
       ORDER BY ia.interactionDateTime DESC
       OFFSET @${paramOffset} ROWS FETCH NEXT @${paramOffset + 1} ROWS ONLY`,
      [from, to, ...extraParams, offset, limit],
    );

    return rows.map((r: any) => {
      let catDetail = null;
      try {
        const parsed = typeof r.objection_assessments_json === 'string' ? JSON.parse(r.objection_assessments_json) : r.objection_assessments_json;
        catDetail = parsed?.categories?.[safeCategory] ?? null;
      } catch { /* ignore */ }
      return {
        recordingId: r.recordingId,
        interactionId: r.interactionId,
        summary_short: r.summary_short,
        overall_score: r.overall_score,
        contact_disposition: r.contact_disposition,
        campaign_detected: r.campaign_detected,
        sentiment_overall: r.sentiment_overall,
        agent: r.agent,
        interactionDateTime: r.interactionDateTime,
        campaign: r.campaign,
        outcome: r.outcome,
        objection_detail: catDetail,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CAMPAIGN COMPLIANCE METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getCampaignComplianceMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[], vehicleMake?: string, vehicleModels?: string[]) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);

    const stats = await this.insightsRepo.manager.query<Array<Record<string, string>>>(
      `SELECT
        COUNT(*) AS total_with_compliance,
        SUM(CASE WHEN JSON_VALUE(ii.campaign_compliance_json, '$.itc_statement_read') = 'true' THEN 1 ELSE 0 END) AS itc_read,
        SUM(CASE WHEN JSON_VALUE(ii.campaign_compliance_json, '$.dpa_3_elements_verified') = 'true' THEN 1 ELSE 0 END) AS dpa_verified,
        SUM(CASE WHEN JSON_VALUE(ii.campaign_compliance_json, '$.four_options_explained') = 'true' THEN 1 ELSE 0 END) AS four_options,
        SUM(CASE WHEN JSON_VALUE(ii.campaign_compliance_json, '$.lost_sale_identified') = 'true' THEN 1 ELSE 0 END) AS lost_sale_id,
        SUM(CASE WHEN JSON_VALUE(ii.campaign_compliance_json, '$.six_month_callback_advised') = 'true' THEN 1 ELSE 0 END) AS six_month_callback,
        SUM(CASE WHEN JSON_VALUE(ii.campaign_compliance_json, '$.fpi_confirmed_with_customer_agreement') = 'true' THEN 1 ELSE 0 END) AS fpi_confirmed
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE ii.campaign_compliance_json IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}`,
      [from, to, ...extraParams],
    );

    const byCampaign = await this.insightsRepo.manager.query<Array<{ campaign: string; count: string }>>(
      `SELECT COALESCE(ii.campaign_detected, 'unknown') AS campaign, COUNT(*) AS count
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE ii.campaign_compliance_json IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}
      GROUP BY COALESCE(ii.campaign_detected, 'unknown')
      ORDER BY COUNT(*) DESC`,
      [from, to, ...extraParams],
    );

    const s = stats[0] ?? {};

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      total_with_compliance: parseInt(s['total_with_compliance'] ?? '0', 10),
      compliance_rates: {
        itc_statement_read: parseInt(s['itc_read'] ?? '0', 10),
        dpa_3_elements_verified: parseInt(s['dpa_verified'] ?? '0', 10),
        four_options_explained: parseInt(s['four_options'] ?? '0', 10),
        lost_sale_identified: parseInt(s['lost_sale_id'] ?? '0', 10),
        six_month_callback_advised: parseInt(s['six_month_callback'] ?? '0', 10),
        fpi_confirmed_with_customer_agreement: parseInt(s['fpi_confirmed'] ?? '0', 10),
      },
      by_campaign: byCampaign.map((r) => ({
        campaign: r.campaign,
        count: parseInt(r.count, 10),
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // NARRATIVE GENERATION
  // ─────────────────────────────────────────────────────────────────────────────

  async getNarrativeSummary(
    from: Date,
    to: Date,
    filterKey: InteractionFilter = 'calls',
    provider?: InsightsProviderName,
    narrativeType: NarrativeType = 'generic',
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
    model?: string,
  ) {
    const selectedProvider =
      provider ??
      (process.env.INSIGHTS_PROVIDER as InsightsProviderName | undefined) ??
      'openai';

    const storedKey = [filterKey, selectedProvider, model ?? 'default', campaign ?? 'all', agent ?? 'all'].join('__');

    const cached = await this.summariesRepo.findOne({
      where: { fromUtc: from, toUtc: to, filterKey: storedKey, narrativeType },
      order: { createdAt: 'DESC' },
    });

    if (cached) {
      return {
        window: {
          from: cached.fromUtc.toISOString(),
          to: cached.toUtc.toISOString(),
        },
        filterKey,
        narrativeType,
        providerUsed: selectedProvider,
        narrative: cached.narrativeJson ? safeParseJson(cached.narrativeJson) : null,
        metrics: cached.metricsJson ? safeParseJson(cached.metricsJson) : null,
        cached: true,
        createdAt: cached.createdAt,
        model: cached.model,
      };
    }

    // Fetch the appropriate metrics and build the right prompt. The prompt
    // template is loaded from the editable `narrative.<type>` fragment (Prompts
    // page); when absent the build function falls back to its hardcoded default.
    let metrics: unknown;
    let prompt: string;

    const promptTemplate =
      (await this.prompts.getActiveFragmentBody(`narrative.${narrativeType}`)) ??
      undefined;

    if (narrativeType === 'calls_operations') {
      metrics = await this.getOperationsMetrics(from, to, filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
      prompt = buildCallsOperationsNarrativePrompt(metrics, promptTemplate);
    } else if (narrativeType === 'calls_client_services') {
      metrics = await this.getClientServicesMetrics(from, to, filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
      prompt = buildCallsClientServicesNarrativePrompt(metrics, promptTemplate);
    } else if (narrativeType === 'chats_operations') {
      metrics = await this.getOperationsMetrics(from, to, filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
      prompt = buildChatsOperationsNarrativePrompt(metrics, promptTemplate);
    } else if (narrativeType === 'chats_client_services') {
      metrics = await this.getClientServicesMetrics(from, to, filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
      prompt = buildChatsClientServicesNarrativePrompt(metrics, promptTemplate);
    } else if (narrativeType === 'survey_analytics') {
      const surveyMetrics = await this.gatherSurveyMetricsForNarrative(from, to, campaign);
      metrics = surveyMetrics.aggregated;
      prompt = buildSurveyAnalyticsNarrativePrompt(surveyMetrics.aggregated, surveyMetrics.freeText, promptTemplate);
    } else {
      metrics = await this.getMetricsSummary(from, to, filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
      prompt = buildNarrativeSummaryPrompt(metrics, promptTemplate);
    }

    const llmProvider = createProvider(selectedProvider, model);

    let firstPass = await llmProvider.extract(prompt);
    let jsonText = firstPass.text;

    let parsedNarrative: NarrativeSummary | Record<string, unknown> | null = null;

    const parse = narrativeType === 'generic'
      ? (t: string) => parseNarrativeSummaryJson(t)
      : (t: string) => parseAnyNarrativeJson(t);

    try {
      parsedNarrative = parse(jsonText);
    } catch {
      const retryPrompt = `
Your previous response was invalid.

Return ONLY valid JSON matching this exact schema and nothing else.

${prompt}
`.trim();

      const retry = await llmProvider.extract(retryPrompt);
      jsonText = retry.text;
      parsedNarrative = parse(jsonText);
      firstPass = retry;
    }

    if (!parsedNarrative) {
      throw new BadRequestException('Failed to generate valid narrative JSON');
    }

    await this.summariesRepo.upsert(
      {
        fromUtc: from,
        toUtc: to,
        filterKey: storedKey,
        narrativeType,
        metricsJson: JSON.stringify(metrics),
        narrativeJson: JSON.stringify(parsedNarrative),
        model: firstPass.model,
      },
      ['fromUtc', 'toUtc', 'filterKey', 'narrativeType'],
    );

    return {
      window: (metrics as any).window,
      filterKey,
      narrativeType,
      providerUsed: firstPass.provider,
      model: firstPass.model,
      narrative: parsedNarrative,
      metrics,
      cached: false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SURVEY: GATHER METRICS + FREE-TEXT FOR NARRATIVE
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Per-interaction "Ask AI" ───────────────────────────────────────────────
  // Answers a free-text question about ONE interaction (any type), grounded in
  // its metadata, insight / survey answers and transcript (when present).
  async askInteraction(id: string, question: string, provider?: string) {
    const q = (question ?? '').trim().slice(0, 1000);
    if (!q) return { answer: 'Please enter a question.', model: null, provider: null };

    const rows = await this.insightsRepo.manager.query<Array<{
      campaign: string | null; vehicleMake: string | null; vehicleModel: string | null;
      dealer: string | null; agent: string | null; outcome: string | null;
      interactionDateTime: Date | null; interactionType: string | null;
      summary_short: string | null; summary_detailed: string | null;
      campaign_answers_json: string | null; insight_json: string | null; transcript: string | null;
    }>>(
      `SELECT TOP 1
        ia.campaign, ia.vehicleMake, ia.vehicleModel, ia.dealer, ia.agent, ia.outcome,
        ia.interactionDateTime, ia.interactionType,
        ii.summary_short, ii.summary_detailed,
        ii.campaign_answers_json, ii.json AS insight_json,
        t.text AS transcript
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      LEFT JOIN app.interaction_transcripts t ON t.recordingId = ia.id
      WHERE CAST(ia.id AS VARCHAR(36)) = @0
         OR CAST(TRY_CAST(JSON_VALUE(ii.campaign_answers_json, '$.meta.id_opportunity') AS INT) AS VARCHAR(20)) = @0`,
      [String(id)],
    );
    const row = rows[0];
    if (!row) return { answer: 'Could not find that interaction.', model: null, provider: null };

    const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const context = {
      campaign: row.campaign,
      vehicle: { make: row.vehicleMake, model: row.vehicleModel },
      dealer: row.dealer,
      agent: row.agent,
      outcome: row.outcome,
      interactionDateTime: row.interactionDateTime,
      interactionType: row.interactionType,
      summary_short: row.summary_short,
      summary_detailed: row.summary_detailed,
      survey_answers: parse(row.campaign_answers_json),
      insight: parse(row.insight_json),
    };
    const transcript = (row.transcript ?? '').slice(0, 12000);

    const prompt = buildInteractionQaPrompt(context, transcript, q);
    const llm = createProvider(provider as InsightsProviderName | undefined);
    const res = await llm.extract(prompt);
    let answer = '';
    try { answer = parse(res.text)?.answer ?? ''; } catch { answer = ''; }
    if (!answer) answer = res.text?.trim() || 'No answer was produced.';

    return { answer, model: res.model, provider: res.provider };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SURVEY: GATHER METRICS + FREE-TEXT FOR NARRATIVE (campaign_answers_json)
  // ─────────────────────────────────────────────────────────────────────────────

  // Sourced from interaction_insights.campaign_answers_json (survey answers are
  // written there per interaction — see sql/nmgb_survey_insights.sql), NOT from
  // the decommissioned app.survey_responses table. Scoped to survey-type
  // insights so it never mixes in Parity / other campaigns that share the
  // campaign_answers_json column.
  private async gatherSurveyMetricsForNarrative(from: Date, to: Date, campaign?: string) {
    const parts: string[] = [
      'ii.campaign_answers_json IS NOT NULL',
      `ii.conversation_type = 'survey'`,
      'COALESCE(ia.interactionDateTime, ia.createdAt) >= @0',
      'COALESCE(ia.interactionDateTime, ia.createdAt) < @1',
    ];
    const params: any[] = [from, to];
    if (campaign) {
      parts.push(`ia.campaign = @${params.length}`);
      params.push(campaign);
    }
    const where = 'WHERE ' + parts.join(' AND ');
    const FROM = `FROM app.interaction_insights ii INNER JOIN app.interactions ia ON ia.id = ii.recordingId`;
    const effDate = 'COALESCE(ia.interactionDateTime, ia.createdAt)';

    // A survey boolean flag in the JSON may serialise as true / 1 / "Yes"
    // depending on the source column type — treat all as set.
    const jv = (p: string) => `JSON_VALUE(ii.campaign_answers_json, '${p}')`;
    const flag = (p: string, alias: string) =>
      `SUM(CASE WHEN ${jv(p)} IN ('true', '1', 'Yes', 'Y') THEN 1 ELSE 0 END) AS ${alias}`;
    const isSet = (p: string) => `${jv(p)} IS NOT NULL AND ${jv(p)} <> ''`;

    const totals = await this.insightsRepo.manager.query(
      `SELECT COUNT(1) AS total,
        SUM(CASE WHEN ${jv('$.meta.flow_status')} = 'Survey Taken' THEN 1 ELSE 0 END) AS survey_taken,
        SUM(CASE WHEN ${isSet('$.competitor_purchase.make')} THEN 1 ELSE 0 END) AS defections,
        ${flag('$.purchase_status.still_considering', 'still_considering')}
      ${FROM} ${where}`, params,
    );

    const categories = await this.insightsRepo.manager.query(
      `SELECT COALESCE(ia.outcome, 'Unknown') AS category, COUNT(1) AS count
       ${FROM} ${where} GROUP BY ia.outcome ORDER BY COUNT(1) DESC`, params,
    );

    // Initial interest — full 9-factor set (campaign_answers_json fidelity).
    const interestFactors = await this.insightsRepo.manager.query(
      `SELECT
        ${flag('$.initial_interest.styling_design', 'styling')},
        ${flag('$.initial_interest.brand_reputation', 'brand_reputation')},
        ${flag('$.initial_interest.brand_loyalty', 'brand_loyalty')},
        ${flag('$.initial_interest.recommendation', 'recommendation')},
        ${flag('$.initial_interest.features', 'features')},
        ${flag('$.initial_interest.size_practicality', 'size_practicality')},
        ${flag('$.initial_interest.performance', 'performance')},
        ${flag('$.initial_interest.price_value', 'price_value')}
      ${FROM} ${where}`, params,
    );

    const notPurchaseReasons = await this.insightsRepo.manager.query(
      `SELECT
        ${flag('$.not_purchased_reasons.price', 'price')},
        ${flag('$.not_purchased_reasons.expectations', 'expectations')},
        ${flag('$.not_purchased_reasons.different_brand', 'different_brand')},
        ${flag('$.not_purchased_reasons.different_client_model', 'different_model')},
        ${flag('$.not_purchased_reasons.financing', 'financing')},
        ${flag('$.not_purchased_reasons.dealership_experience', 'dealership')},
        ${flag('$.not_purchased_reasons.no_interest_in_evs', 'no_interest_in_evs')}
      ${FROM} ${where}`, params,
    );

    // Purchase influence — the full 18-factor P4 Q6 set (only in the JSON).
    const influenceFactors = await this.insightsRepo.manager.query(
      `SELECT
        ${flag('$.influenced_by.apr_lower', 'apr_lower')},
        ${flag('$.influenced_by.better_value', 'better_value')},
        ${flag('$.influenced_by.brand_loyalty', 'brand_loyalty')},
        ${flag('$.influenced_by.colour_spec_pref', 'colour_spec_pref')},
        ${flag('$.influenced_by.comfortable_interior', 'comfortable_interior')},
        ${flag('$.influenced_by.customer_service', 'customer_service')},
        ${flag('$.influenced_by.discount', 'discount')},
        ${flag('$.influenced_by.drive_of_vehicle', 'drive_of_vehicle')},
        ${flag('$.influenced_by.enhanced_features', 'enhanced_features')},
        ${flag('$.influenced_by.longer_warranty', 'longer_warranty')},
        ${flag('$.influenced_by.monthly_payments_lower', 'monthly_payments_lower')},
        ${flag('$.influenced_by.powertrain_options', 'powertrain_options')},
        ${flag('$.influenced_by.pref_design', 'pref_design')},
        ${flag('$.influenced_by.quicker_delivery', 'quicker_delivery')},
        ${flag('$.influenced_by.size', 'size')},
        ${flag('$.influenced_by.try_different', 'try_different')}
      ${FROM} ${where}`, params,
    );

    const competitorPurchases = await this.insightsRepo.manager.query<Array<{ make: string; count: string }>>(
      `SELECT ${jv('$.competitor_purchase.make')} AS make, COUNT(1) AS count
       ${FROM} ${where} AND ${isSet('$.competitor_purchase.make')}
       GROUP BY ${jv('$.competitor_purchase.make')} ORDER BY COUNT(1) DESC`, params,
    );
    // Tag each competitor make Chinese / other and roll up the headline share.
    const competitorBrands = competitorPurchases.map((r) => ({
      make: r.make, count: parseInt(r.count, 10), chinese: isChineseOem(r.make),
    }));
    const totalDefections = competitorBrands.reduce((a, b) => a + b.count, 0);
    const chineseDefections = competitorBrands.filter((b) => b.chinese).reduce((a, b) => a + b.count, 0);

    const dealerRatings = await this.insightsRepo.manager.query(
      `SELECT ia.dealer, AVG(TRY_CAST(${jv('$.dealership_rating.score')} AS FLOAT)) AS avg_rating, COUNT(1) AS count
       ${FROM} ${where} AND ia.dealer IS NOT NULL AND ${jv('$.dealership_rating.score')} IS NOT NULL
       GROUP BY ia.dealer HAVING COUNT(1) >= 2 ORDER BY AVG(TRY_CAST(${jv('$.dealership_rating.score')} AS FLOAT)) ASC`, params,
    );

    const modelPerformance = await this.insightsRepo.manager.query(
      `SELECT ia.vehicleModel AS model, COUNT(1) AS total,
        ${flag('$.purchase_status.still_considering', 'still_considering')},
        SUM(CASE WHEN ${isSet('$.competitor_purchase.make')} THEN 1 ELSE 0 END) AS purchased_elsewhere
      ${FROM} ${where} AND ia.vehicleModel IS NOT NULL
      GROUP BY ia.vehicleModel HAVING COUNT(1) >= 2 ORDER BY COUNT(1) DESC`, params,
    );

    // Quarter-on-quarter: totals + defections, plus per-quarter competitor makes
    // so Chinese-OEM share by quarter can be folded in (Prompt 3).
    const quarterTotals = await this.insightsRepo.manager.query<Array<{
      yr: string; qtr: string; total: string; defections: string;
    }>>(
      `SELECT YEAR(${effDate}) AS yr, DATEPART(QUARTER, ${effDate}) AS qtr,
        COUNT(1) AS total,
        SUM(CASE WHEN ${isSet('$.competitor_purchase.make')} THEN 1 ELSE 0 END) AS defections
      ${FROM} ${where}
      GROUP BY YEAR(${effDate}), DATEPART(QUARTER, ${effDate})
      ORDER BY YEAR(${effDate}), DATEPART(QUARTER, ${effDate})`, params,
    );
    const quarterMakes = await this.insightsRepo.manager.query<Array<{
      yr: string; qtr: string; make: string; count: string;
    }>>(
      `SELECT YEAR(${effDate}) AS yr, DATEPART(QUARTER, ${effDate}) AS qtr,
        ${jv('$.competitor_purchase.make')} AS make, COUNT(1) AS count
      ${FROM} ${where} AND ${isSet('$.competitor_purchase.make')}
      GROUP BY YEAR(${effDate}), DATEPART(QUARTER, ${effDate}), ${jv('$.competitor_purchase.make')}`, params,
    );
    const chineseByQuarter = new Map<string, number>();
    for (const r of quarterMakes) {
      if (!isChineseOem(r.make)) continue;
      const key = `${r.yr}-${r.qtr}`;
      chineseByQuarter.set(key, (chineseByQuarter.get(key) ?? 0) + parseInt(r.count, 10));
    }
    const quarterlyTrend = quarterTotals.map((r) => {
      const defections = parseInt(r.defections, 10);
      const chinese = chineseByQuarter.get(`${r.yr}-${r.qtr}`) ?? 0;
      return {
        quarter: `${r.yr} Q${r.qtr}`,
        total: parseInt(r.total, 10),
        defections,
        chinese_defections: chinese,
        chinese_share_pct: defections ? Math.round((chinese / defections) * 100) : 0,
      };
    });

    // Free-text samples (up to 100 records with any text content).
    const freeText = await this.insightsRepo.manager.query(
      `SELECT TOP 100
        ${jv('$.meta.id_opportunity')} AS id_opportunity, ia.vehicleModel AS model, ia.dealer AS dealer, ia.outcome AS result_code,
        ${jv('$.agent_notes')} AS agent_notes,
        ${jv('$.dealership_rating.feedback')} AS dealership_rating_feedback,
        ${jv('$.dealer_visit.why_no_test_drive')} AS why_no_test_drive,
        ${jv('$.dealer_visit.vehicle_impression')} AS vehicle_impression,
        ${jv('$.not_purchased_reasons.other_feedback')} AS not_purchased_feedback,
        ${jv('$.purchase_reason')} AS purchase_reason,
        ${jv('$.improvements.anything_different')} AS improve_anything,
        ${jv('$.improvements.follow_up')} AS improve_follow_up,
        ${jv('$.competitor_purchase.make')} AS purchased_make,
        ${jv('$.competitor_purchase.model')} AS purchased_model
      ${FROM} ${where}
        AND (${jv('$.agent_notes')} IS NOT NULL OR ${jv('$.dealership_rating.feedback')} IS NOT NULL
             OR ${jv('$.dealer_visit.why_no_test_drive')} IS NOT NULL OR ${jv('$.dealer_visit.vehicle_impression')} IS NOT NULL
             OR ${jv('$.purchase_reason')} IS NOT NULL OR ${jv('$.improvements.anything_different')} IS NOT NULL)
      ORDER BY ${effDate} DESC`, params,
    );

    // Transcript-mined insights (campaign_transcript_json) — the qualitative
    // layer the survey feed lacks: consideration (not just completed purchases),
    // balanced sentiment, transcript-derived competitor reasons, frustrations
    // with recommended actions, and verbatim quotes. Fail-soft: if the column /
    // data isn't present yet, the narrative still runs on survey data alone.
    let transcript: any = null;
    try {
      transcript = await this.surveyAnalytics.getTranscriptInsights({ from, to, campaign });
    } catch {
      transcript = null;
    }

    return {
      aggregated: {
        totals: totals[0] ?? {},
        categories,
        interest_factors: interestFactors[0] ?? {},
        not_purchase_reasons: notPurchaseReasons[0] ?? {},
        purchase_influence_factors: influenceFactors[0] ?? {},
        competitor_purchases: competitorBrands,
        chinese_oem: {
          total_defections: totalDefections,
          chinese_defections: chineseDefections,
          chinese_share_pct: totalDefections ? Math.round((chineseDefections / totalDefections) * 100) : 0,
          chinese_brands: competitorBrands.filter((b) => b.chinese),
        },
        quarterly_trend: quarterlyTrend,
        dealer_ratings: dealerRatings.slice(0, 15),
        model_performance: modelPerformance.slice(0, 15),
        // Transcript layer (may be null if not yet processed).
        transcript,
      },
      freeText,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: DIMENSION COMPARISON (overall vs agent)
  // ─────────────────────────────────────────────────────────────────────────────

  private readonly dimensionAvgSql = `SELECT
    -- Call dimensions
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.intro.score') AS FLOAT)) AS intro,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.data_protection.score') AS FLOAT)) AS data_protection,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.campaign_focus.score') AS FLOAT)) AS campaign_focus,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.disclaimer.score') AS FLOAT)) AS disclaimer,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.gdpr.score') AS FLOAT)) AS gdpr,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.correct_outcome.score') AS FLOAT)) AS correct_outcome,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.tone_pace.score') AS FLOAT)) AS tone_pace,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.delivery.score') AS FLOAT)) AS delivery,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.questioning.score') AS FLOAT)) AS questioning,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.rapport.score') AS FLOAT)) AS rapport,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.objection_handling.score') AS FLOAT)) AS objection_handling,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.active_listening.score') AS FLOAT)) AS active_listening,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.product_knowledge.score') AS FLOAT)) AS product_knowledge,
    -- Chat dimensions
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.response_time.score') AS FLOAT)) AS response_time,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.accept_time.score') AS FLOAT)) AS accept_time,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.product_process.score') AS FLOAT)) AS product_process,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.engagement.score') AS FLOAT)) AS engagement,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.tone.score') AS FLOAT)) AS tone,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.paraphrase_close.score') AS FLOAT)) AS paraphrase_close,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.language_accuracy.score') AS FLOAT)) AS language_accuracy,
    AVG(CAST(JSON_VALUE(ii.operations_scores_json, '$.contact_details.score') AS FLOAT)) AS contact_details,
    -- Shared
    AVG(ii.overall_score) AS overall_score,
    COUNT(1) AS count
  FROM app.interaction_insights ii
  INNER JOIN app.interactions ia ON ia.id = ii.recordingId
  WHERE ii.operations_scores_json IS NOT NULL
    AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1`;

  // RAC QA dimension averages: percentage of "yes" answers per question, plus section scores
  private readonly qaAvgSql = `SELECT
    -- Correct Process (Q1-Q4)
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q1_polite_friendly.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q1_polite_friendly.answer') = 'no' THEN 0.0 END) AS q1_polite_friendly,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q2_clear_understandable.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q2_clear_understandable.answer') = 'no' THEN 0.0 END) AS q2_clear_understandable,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q3_accurate_info.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q3_accurate_info.answer') = 'no' THEN 0.0 END) AS q3_accurate_info,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q4_next_steps_clear.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.q4_next_steps_clear.answer') = 'no' THEN 0.0 END) AS q4_next_steps_clear,
    AVG(CAST(JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.section_score') AS FLOAT)) AS correct_process_score,
    -- Service Standard (Q5-Q8)
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q5_polite_friendly.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q5_polite_friendly.answer') = 'no' THEN 0.0 END) AS q5_polite_friendly,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q6_services_clear.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q6_services_clear.answer') = 'no' THEN 0.0 END) AS q6_services_clear,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q7_next_steps_clear.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q7_next_steps_clear.answer') = 'no' THEN 0.0 END) AS q7_next_steps_clear,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q8_accurate_info.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.q8_accurate_info.answer') = 'no' THEN 0.0 END) AS q8_accurate_info,
    AVG(CAST(JSON_VALUE(ii.qa_scores_json, '$.scores.service_standard.section_score') AS FLOAT)) AS service_standard_score,
    -- Right Outcome (Q9-Q15)
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q9_id_verification.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q9_id_verification.answer') = 'no' THEN 0.0 END) AS q9_id_verification,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q10_fair_not_misleading.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q10_fair_not_misleading.answer') = 'no' THEN 0.0 END) AS q10_fair_not_misleading,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q11_needs_established.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q11_needs_established.answer') = 'no' THEN 0.0 END) AS q11_needs_established,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q12_best_interest.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q12_best_interest.answer') = 'no' THEN 0.0 END) AS q12_best_interest,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q13_vulnerability.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q13_vulnerability.answer') = 'no' THEN 0.0 END) AS q13_vulnerability,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q14_brand_representation.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q14_brand_representation.answer') = 'no' THEN 0.0 END) AS q14_brand_representation,
    AVG(CASE WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q15_eligible_products.answer') = 'yes' THEN 10.0
              WHEN JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q15_eligible_products.answer') = 'no' THEN 0.0 END) AS q15_eligible_products,
    AVG(CAST(JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.section_score') AS FLOAT)) AS right_outcome_score,
    -- Overall
    AVG(ii.overall_score) AS overall_score,
    AVG(CAST(JSON_VALUE(ii.qa_scores_json, '$.overall_score') AS FLOAT)) AS qa_overall_score,
    COUNT(1) AS count
  FROM app.interaction_insights ii
  INNER JOIN app.interactions ia ON ia.id = ii.recordingId
  WHERE JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.section_score') IS NOT NULL
    AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1`;

  async getOpsDimensionComparison(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
    excludePartial = false,
  ) {
    // Partial-exclusion clauses: fall back to JSON_VALUE on the raw `json` blob
    // so the filter still bites on records that predate the indexed bit column.
    // ISJSON guard keeps malformed legacy rows from breaking the query.
    const opsPartialClause = excludePartial
      ? `AND (
          ii.operations_partial_scoring = 0
          OR (
            ii.operations_partial_scoring IS NULL
            AND (
              ii.json IS NULL
              OR ISJSON(ii.json) = 0
              OR JSON_VALUE(ii.json, '$.operations.scoring_flags.partial_scoring') IS NULL
              OR JSON_VALUE(ii.json, '$.operations.scoring_flags.partial_scoring') <> 'true'
            )
          )
        )`
      : '';
    const qaPartialClause = excludePartial
      ? `AND (
          ii.qa_partial_scoring = 0
          OR (
            ii.qa_partial_scoring IS NULL
            AND (
              ii.json IS NULL
              OR ISJSON(ii.json) = 0
              OR JSON_VALUE(ii.json, '$.qa_assessment.scoring_flags.partial_scoring') IS NULL
              OR JSON_VALUE(ii.json, '$.qa_assessment.scoring_flags.partial_scoring') <> 'true'
            )
          )
        )`
      : '';

    // Overall averages (no agent filter)
    const { clause: overallClause, extraParams: overallParams } = this.buildRawFilters(filterKey, campaign, undefined, excludeOutcomes, vehicleMake, vehicleModels);
    const overall = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
      `${this.dimensionAvgSql} ${overallClause} ${opsPartialClause}`,
      [from, to, ...overallParams],
    );

    // RAC QA averages (overall, no agent filter)
    const qaOverall = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
      `${this.qaAvgSql} ${overallClause} ${qaPartialClause}`,
      [from, to, ...overallParams],
    );

    // Distinct agents with score count in the current dataset
    const agentsInData = await this.insightsRepo.manager.query<Array<{ agent: string; count: string; avg_score: string }>>(
      `SELECT ia.agent, COUNT(1) AS count, AVG(ii.overall_score) AS avg_score
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ii.overall_score IS NOT NULL
         AND ia.agent IS NOT NULL AND ia.agent != ''
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${overallClause}
       GROUP BY ia.agent
       ORDER BY ia.agent`,
      [from, to, ...overallParams],
    );

    let agentData: Record<string, number | null> | null = null;
    let qaAgentData: Record<string, number | null> | null = null;
    if (agent) {
      const { clause: agentClause, extraParams: agentParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
      const agentResult = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
        `${this.dimensionAvgSql} ${agentClause} ${opsPartialClause}`,
        [from, to, ...agentParams],
      );
      agentData = agentResult[0] ?? null;

      const qaAgentResult = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
        `${this.qaAvgSql} ${agentClause} ${qaPartialClause}`,
        [from, to, ...agentParams],
      );
      qaAgentData = qaAgentResult[0] ?? null;
    }

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      overall: overall[0] ?? {},
      agent: agentData,
      agentName: agent ?? null,
      qa_overall: qaOverall[0] ?? null,
      qa_agent: qaAgentData,
      agents_in_data: agentsInData.map((r) => ({
        agent: r.agent,
        count: parseInt(r.count, 10),
        avg_score: r.avg_score !== null ? parseFloat(String(r.avg_score)) : null,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: INTERACTIONS BY SCORE BUCKET
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByScoreBucket(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    bucket: string, limit = 50, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const ranges: Record<string, [number, number]> = {
      below_5: [0, 5],
      '5_to_7': [5, 7],
      '7_to_9': [7, 9],
      '9_plus': [9, 10.01],
    };
    const range = ranges[bucket];
    if (!range) return [];

    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ii.overall_score >= @${paramOffset} AND ii.overall_score < @${paramOffset + 1}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY ii.overall_score ASC
       OFFSET @${paramOffset + 2} ROWS FETCH NEXT @${paramOffset + 3} ROWS ONLY`,
      [from, to, ...extraParams, range[0], range[1], offset, limit],
    );

    return rows.map((r: any) => ({
      ...r,
      coaching_json: r.coaching_json ? safeParseJson(r.coaching_json) : null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: INTERACTIONS BY COACHING NEED
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByCoachingNeed(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    need: string, limit = 50, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    const rows = await this.insightsRepo.manager.query(
      `SELECT DISTINCT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       CROSS APPLY OPENJSON(ii.coaching_json, '$.needs_improvement') j
       WHERE LOWER(LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(j.value, '.', ''), '!', ''), ',', '')))) LIKE @${paramOffset}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY ii.overall_score ASC
       OFFSET @${paramOffset + 1} ROWS FETCH NEXT @${paramOffset + 2} ROWS ONLY`,
      [from, to, ...extraParams, `%${need.toLowerCase().trim()}%`, offset, limit],
    );

    return rows.map((r: any) => ({
      ...r,
      coaching_json: r.coaching_json ? safeParseJson(r.coaching_json) : null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: INTERACTIONS BY OUTCOME
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: VULNERABLE CUSTOMERS (Consumer Duty) — from QA question Q13.
  // q13_vulnerability.answer = 'yes' (vulnerable + handled well), 'no' (vulnerable
  // + NOT handled — the compliance risk), or n/a/missing (no vulnerability).
  // ─────────────────────────────────────────────────────────────────────────────

  private readonly Q13_ANSWER =
    `JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q13_vulnerability.answer')`;
  private readonly Q13_RATIONALE =
    `JSON_VALUE(ii.qa_scores_json, '$.scores.right_outcome.q13_vulnerability.rationale')`;

  async getVulnerabilityMetrics(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const rows = await this.insightsRepo.manager.query<Array<{ handled: string; not_handled: string; total_qa: string }>>(
      `SELECT
         SUM(CASE WHEN ${this.Q13_ANSWER} = 'yes' THEN 1 ELSE 0 END) AS handled,
         SUM(CASE WHEN ${this.Q13_ANSWER} = 'no' THEN 1 ELSE 0 END) AS not_handled,
         COUNT(1) AS total_qa
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ii.qa_scores_json IS NOT NULL
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}`,
      [from, to, ...extraParams],
    );
    const r = rows[0];
    const handled = parseInt(r?.handled ?? '0', 10);
    const not_handled = parseInt(r?.not_handled ?? '0', 10);
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      total_qa: parseInt(r?.total_qa ?? '0', 10),
      identified: handled + not_handled,
      handled,
      not_handled,
    };
  }

  async getVulnerabilityInteractions(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    answer?: string, limit = 200, offset = 0,
    campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const conds = [`${this.Q13_ANSWER} IN ('yes', 'no')`];
    const params: any[] = [from, to, ...extraParams];
    if (answer === 'yes' || answer === 'no') {
      conds.push(`${this.Q13_ANSWER} = @${params.length}`);
      params.push(answer);
    }
    const offIdx = params.length;
    return this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId,
              ${this.Q13_ANSWER} AS vuln_answer, ${this.Q13_RATIONALE} AS vuln_rationale
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ${conds.join(' AND ')}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY CASE WHEN ${this.Q13_ANSWER} = 'no' THEN 0 ELSE 1 END, COALESCE(ia.interactionDateTime, ia.createdAt) DESC
       OFFSET @${offIdx} ROWS FETCH NEXT @${offIdx + 1} ROWS ONLY`,
      [...params, offset, limit],
    );
  }

  async getInteractionsByOutcome(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    outcome: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = outcome === 'unknown';
    const outcomeCondition = isUnknown
      ? `(ia.outcome IS NULL OR ia.outcome = '')`
      : `ia.outcome = @${paramOffset}`;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ${outcomeCondition}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY ii.overall_score ASC
       OFFSET @${isUnknown ? paramOffset : paramOffset + 1} ROWS FETCH NEXT @${isUnknown ? paramOffset + 1 : paramOffset + 2} ROWS ONLY`,
      [from, to, ...extraParams, ...(isUnknown ? [offset, limit] : [outcome, offset, limit])],
    );

    return rows.map((r: any) => ({
      ...r,
      coaching_json: r.coaching_json ? safeParseJson(r.coaching_json) : null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: INTERACTIONS WITH PARTIAL SCORE FLAG, GROUPED BY OUTCOME
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByPartialScoreOutcome(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    outcome: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
    layer: 'ops' | 'qa' = 'ops',
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = outcome === 'unknown';
    const outcomeCondition = isUnknown
      ? `(ia.outcome IS NULL OR ia.outcome = '')`
      : `ia.outcome = @${paramOffset}`;

    const flagColumn = layer === 'qa' ? 'qa_partial_scoring' : 'operations_partial_scoring';
    const jsonPath = layer === 'qa'
      ? '$.qa_assessment.scoring_flags.partial_scoring'
      : '$.operations.scoring_flags.partial_scoring';

    const partialFlagCondition = `(
      ii.${flagColumn} = 1
      OR (
        ii.${flagColumn} IS NULL
        AND ISJSON(ii.json) = 1
        AND JSON_VALUE(ii.json, '${jsonPath}') = 'true'
      )
    )`;

    const offsetIdx = isUnknown ? paramOffset : paramOffset + 1;
    const limitIdx = isUnknown ? paramOffset + 1 : paramOffset + 2;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ${outcomeCondition}
         AND ${partialFlagCondition}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY COALESCE(ia.interactionDateTime, ia.createdAt) DESC
       OFFSET @${offsetIdx} ROWS FETCH NEXT @${limitIdx} ROWS ONLY`,
      [from, to, ...extraParams, ...(isUnknown ? [offset, limit] : [outcome, offset, limit])],
    );

    return rows.map((r: any) => ({
      ...r,
      coaching_json: r.coaching_json ? safeParseJson(r.coaching_json) : null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: INTERACTIONS WITH LOW-SCORE ALERT, GROUPED BY AGENT
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByLowScoreAlertAgent(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    targetAgent: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
    layer: 'ops' | 'qa' = 'ops',
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = targetAgent === 'unknown';
    const agentCondition = isUnknown
      ? `(ia.agent IS NULL OR ia.agent = '')`
      : `ia.agent = @${paramOffset}`;

    const flagColumn = layer === 'qa' ? 'qa_low_score_alert' : 'operations_low_score_alert';
    const jsonPath = layer === 'qa'
      ? '$.qa_assessment.scoring_flags.low_score_alert'
      : '$.operations.scoring_flags.low_score_alert';

    const lowScoreFlagCondition = `(
      ii.${flagColumn} = 1
      OR (
        ii.${flagColumn} IS NULL
        AND ISJSON(ii.json) = 1
        AND JSON_VALUE(ii.json, '${jsonPath}') = 'true'
      )
    )`;

    const offsetIdx = isUnknown ? paramOffset : paramOffset + 1;
    const limitIdx = isUnknown ? paramOffset + 1 : paramOffset + 2;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ${agentCondition}
         AND ${lowScoreFlagCondition}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY ii.overall_score ASC
       OFFSET @${offsetIdx} ROWS FETCH NEXT @${limitIdx} ROWS ONLY`,
      [from, to, ...extraParams, ...(isUnknown ? [offset, limit] : [targetAgent, offset, limit])],
    );

    return rows.map((r: any) => ({
      ...r,
      coaching_json: r.coaching_json ? safeParseJson(r.coaching_json) : null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CLIENT SERVICES: INTERACTIONS BY INTEREST LEVEL
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByInterestLevel(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    interestLevel: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = interestLevel === 'unknown';
    const condition = isUnknown
      ? `(ii.interest_level IS NULL OR ii.interest_level = '' OR ii.interest_level = 'unknown')`
      : `ii.interest_level = @${paramOffset}`;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.interest_level,
              COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name) AS dealer_name,
              CASE WHEN NULLIF(ia.dealer, '') IS NULL THEN 1 ELSE 0 END AS dealer_inferred,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ${condition}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY ia.interactionDateTime DESC
       OFFSET @${isUnknown ? paramOffset : paramOffset + 1} ROWS FETCH NEXT @${isUnknown ? paramOffset + 1 : paramOffset + 2} ROWS ONLY`,
      [from, to, ...extraParams, ...(isUnknown ? [offset, limit] : [interestLevel, offset, limit])],
    );

    return rows;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CLIENT SERVICES: INTERACTIONS BY COMPETITOR
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByCompetitor(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    competitor: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = competitor === 'unknown';
    const condition = isUnknown
      ? `(ii.competitor_purchased IS NULL OR ii.competitor_purchased = '' OR ii.competitor_purchased = 'unknown')`
      : `ii.competitor_purchased = @${paramOffset}`;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.competitor_purchased,
              COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name) AS dealer_name,
              CASE WHEN NULLIF(ia.dealer, '') IS NULL THEN 1 ELSE 0 END AS dealer_inferred,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ii.has_purchased_elsewhere = 1
         AND ${condition}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY ia.interactionDateTime DESC
       OFFSET @${isUnknown ? paramOffset : paramOffset + 1} ROWS FETCH NEXT @${isUnknown ? paramOffset + 1 : paramOffset + 2} ROWS ONLY`,
      [from, to, ...extraParams, ...(isUnknown ? [offset, limit] : [competitor, offset, limit])],
    );

    return rows;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: OPPORTUNITY METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getOpportunityMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[], vehicleMake?: string, vehicleModels?: string[]) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);

    const rows = await this.insightsRepo.manager.query<Array<{
      total: string;
      opportunities: string;
      not_opportunities: string;
      classified: string;
      unclassified: string;
    }>>(
      `SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN ii.is_opportunity = 1 THEN 1 ELSE 0 END) AS opportunities,
        SUM(CASE WHEN ii.is_opportunity = 0 THEN 1 ELSE 0 END) AS not_opportunities,
        SUM(CASE WHEN ii.is_opportunity IS NOT NULL THEN 1 ELSE 0 END) AS classified,
        SUM(CASE WHEN ii.is_opportunity IS NULL AND ii.opportunity_json IS NOT NULL THEN 1 ELSE 0 END) AS unclassified
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE (ii.is_opportunity IS NOT NULL OR ii.opportunity_json IS NOT NULL)
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}`,
      [from, to, ...extraParams],
    );

    const reasonBreakdown = await this.insightsRepo.manager.query<Array<{ reason: string; count: string }>>(
      `SELECT ii.not_opportunity_reason AS reason, COUNT(1) AS count
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE ii.is_opportunity = 0
        AND ii.not_opportunity_reason IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}
      GROUP BY ii.not_opportunity_reason
      ORDER BY COUNT(1) DESC`,
      [from, to, ...extraParams],
    );

    const stats = rows[0];
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      total: parseInt(stats?.total ?? '0', 10),
      opportunities: parseInt(stats?.opportunities ?? '0', 10),
      not_opportunities: parseInt(stats?.not_opportunities ?? '0', 10),
      classified: parseInt(stats?.classified ?? '0', 10),
      unclassified: parseInt(stats?.unclassified ?? '0', 10),
      reason_breakdown: reasonBreakdown.map((r) => ({
        reason: r.reason,
        count: parseInt(r.count, 10),
      })),
    };
  }

  async getInteractionsByOpportunityReason(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    reason: string, limit = 50, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels);
    const paramOffset = 2 + extraParams.length;

    let isOpportunityFilter: string;
    let extraQueryParams: string[];
    if (reason === '__opportunity') {
      isOpportunityFilter = `ii.is_opportunity = 1`;
      extraQueryParams = [];
    } else if (reason === '__unclassified') {
      isOpportunityFilter = `ii.is_opportunity IS NULL AND ii.opportunity_json IS NOT NULL`;
      extraQueryParams = [];
    } else {
      isOpportunityFilter = `ii.is_opportunity = 0 AND ii.not_opportunity_reason = @${paramOffset}`;
      extraQueryParams = [reason];
    }

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.is_opportunity,
              ii.not_opportunity_reason, ii.opportunity_json,
              COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name) AS dealer_name,
              CASE WHEN NULLIF(ia.dealer, '') IS NULL THEN 1 ELSE 0 END AS dealer_inferred,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome, ia.interactionTpsId
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ${isOpportunityFilter}
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
       ORDER BY ia.interactionDateTime DESC
       OFFSET @${paramOffset + extraQueryParams.length} ROWS FETCH NEXT @${paramOffset + extraQueryParams.length + 1} ROWS ONLY`,
      [from, to, ...extraParams, ...extraQueryParams, offset, limit],
    );

    return rows.map((r: any) => ({
      ...r,
      opportunity_json: r.opportunity_json ? safeParseJson(r.opportunity_json) : null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPS: SINGLE INTERACTION DETAIL
  // ─────────────────────────────────────────────────────────────────────────────

  async searchInteractions(rawQuery: string, limit = 10) {
    const query = (rawQuery ?? '').trim();
    if (query.length < 3) return [];

    const like = `%${query}%`;
    const rows = await this.recordingsRepo
      .createQueryBuilder('i')
      .leftJoin(InteractionInsight, 'ins', 'ins.recordingId = i.id')
      .select([
        'i.id AS id',
        'i.interactionId AS interactionId',
        'i.interactionTpsId AS interactionTpsId',
        'i.interactionType AS interactionType',
        'i.campaign AS campaign',
        'i.agent AS agent',
        'i.interactionDateTime AS interactionDateTime',
        'i.outcome AS outcome',
        'ins.summary_short AS summaryShort',
      ])
      .where('i.interactionId LIKE :q OR i.interactionTpsId LIKE :q', { q: like })
      .orderBy('i.interactionDateTime', 'DESC')
      .limit(Math.max(1, Math.min(limit, 25)))
      .getRawMany<{
        id: string;
        interactionId: string | null;
        interactionTpsId: string | null;
        interactionType: string | null;
        campaign: string | null;
        agent: string | null;
        interactionDateTime: Date | string | null;
        outcome: string | null;
        summaryShort: string | null;
      }>();

    return rows.map((r) => ({
      id: r.id,
      interactionId: r.interactionId,
      interactionTpsId: r.interactionTpsId,
      interactionType: r.interactionType,
      campaign: r.campaign,
      agent: r.agent,
      interactionDateTime:
        r.interactionDateTime instanceof Date
          ? r.interactionDateTime.toISOString()
          : r.interactionDateTime ?? null,
      outcome: r.outcome,
      summaryShort: r.summaryShort,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PARITY: CAMPAIGN ANALYSIS
  // Aggregates over interaction_insights.campaign_answers_json for the Parity
  // campaign. Queries assume the consumer has already filtered to
  // campaign='Parity' via the campaign param — we don't hard-code it so the
  // same shape can be reused for future Q&A campaigns sharing the schema.
  // ─────────────────────────────────────────────────────────────────────────────

  // Monthly trend of the two Campaign-Insights headline rates — negative-view
  // rate and opportunity rate — over the window, for sparklines. Mirrors the
  // numerators/denominators of getParityCampaignAnalysis + getOpportunityMetrics,
  // bucketed by month.
  async getClientServicesTrends(
    from: Date,
    to: Date,
    filterKey: InteractionFilter = 'calls',
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(
      filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels,
    );
    const effDate = 'COALESCE(ia.interactionDateTime, ia.createdAt)';
    const jv = (p: string) => `JSON_VALUE(ii.campaign_answers_json, '${p}')`;

    const parityRows = await this.insightsRepo.manager.query<Array<{ yr: string; mo: string; total: string; any_neg: string }>>(
      `SELECT YEAR(${effDate}) AS yr, MONTH(${effDate}) AS mo,
         COUNT(1) AS total,
         SUM(CASE WHEN ${jv('$.view_on_brand.answer')} = 'yes'
               OR ${jv('$.view_on_current_vehicle.answer')} = 'yes'
               OR ${jv('$.view_on_dealer.answer')} = 'yes'
               OR ${jv('$.view_on_finance_agreement.answer')} = 'yes' THEN 1 ELSE 0 END) AS any_neg
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ii.campaign_answers_json IS NOT NULL
         AND ${effDate} >= @0 AND ${effDate} < @1 ${filterClause}
       GROUP BY YEAR(${effDate}), MONTH(${effDate})`,
      [from, to, ...extraParams],
    );

    const oppRows = await this.insightsRepo.manager.query<Array<{ yr: string; mo: string; classified: string; opportunities: string }>>(
      `SELECT YEAR(${effDate}) AS yr, MONTH(${effDate}) AS mo,
         SUM(CASE WHEN ii.is_opportunity IS NOT NULL THEN 1 ELSE 0 END) AS classified,
         SUM(CASE WHEN ii.is_opportunity = 1 THEN 1 ELSE 0 END) AS opportunities
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE (ii.is_opportunity IS NOT NULL OR ii.opportunity_json IS NOT NULL)
         AND ${effDate} >= @0 AND ${effDate} < @1 ${filterClause}
       GROUP BY YEAR(${effDate}), MONTH(${effDate})`,
      [from, to, ...extraParams],
    );

    const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
    const months: string[] = [];
    const end = new Date(to.getTime() - 1);
    let y = from.getFullYear(), m = from.getMonth() + 1, guard = 0;
    while ((y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth() + 1)) && guard < 120) {
      months.push(monthKey(y, m)); m++; if (m > 12) { m = 1; y++; } guard++;
    }

    const parityByMonth = new Map<string, { total: number; any_neg: number }>();
    for (const r of parityRows) parityByMonth.set(monthKey(+r.yr, +r.mo), { total: +r.total, any_neg: +r.any_neg });
    const oppByMonth = new Map<string, { classified: number; opportunities: number }>();
    for (const r of oppRows) oppByMonth.set(monthKey(+r.yr, +r.mo), { classified: +r.classified, opportunities: +r.opportunities });

    return {
      months,
      parity_total: months.map((k) => parityByMonth.get(k)?.total ?? 0),
      any_negative_view: months.map((k) => parityByMonth.get(k)?.any_neg ?? 0),
      opp_classified: months.map((k) => oppByMonth.get(k)?.classified ?? 0),
      opportunities: months.map((k) => oppByMonth.get(k)?.opportunities ?? 0),
    };
  }

  async getParityCampaignAnalysis(
    from: Date,
    to: Date,
    filterKey: InteractionFilter = 'calls',
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(
      filterKey,
      campaign,
      agent,
      excludeOutcomes,
      vehicleMake,
      vehicleModels,
    );

    const baseWhere = `
      WHERE ii.campaign_answers_json IS NOT NULL
        AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
        AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}`;

    // Total interactions with campaign_answers data
    const totalRows = await this.insightsRepo.manager.query<Array<{ total: string }>>(
      `SELECT COUNT(1) AS total
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       ${baseWhere}`,
      [from, to, ...extraParams],
    );
    const total = parseInt(totalRows[0]?.total ?? '0', 10);

    // Single-question breakdowns (consent, decision_made, dealer_already_in_touch).
    // Each returns rows of { answer, count } including a NULL bucket when the
    // model couldn't extract an answer.
    const breakdownSql = (jsonPath: string) => `
      SELECT
        COALESCE(JSON_VALUE(ii.campaign_answers_json, '${jsonPath}'), '__missing') AS answer,
        COUNT(1) AS count
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      ${baseWhere}
      GROUP BY JSON_VALUE(ii.campaign_answers_json, '${jsonPath}')`;

    const [
      consentRows,
      decisionRows,
      dealerTouchRows,
      affordabilityRows,
      lifestyleVehicleRows,
    ] = await Promise.all([
      this.insightsRepo.manager.query<Array<{ answer: string; count: string }>>(
        breakdownSql('$.consent_to_dealer.answer'),
        [from, to, ...extraParams],
      ),
      this.insightsRepo.manager.query<Array<{ answer: string; count: string }>>(
        breakdownSql('$.decision_made.answer'),
        [from, to, ...extraParams],
      ),
      this.insightsRepo.manager.query<Array<{ answer: string; count: string }>>(
        breakdownSql('$.dealer_already_in_touch.answer'),
        [from, to, ...extraParams],
      ),
      this.insightsRepo.manager.query<Array<{ answer: string; count: string }>>(
        breakdownSql('$.affordability_issues.answer'),
        [from, to, ...extraParams],
      ),
      this.insightsRepo.manager.query<Array<{ answer: string; count: string }>>(
        breakdownSql('$.lifestyle_change_vehicle.answer'),
        [from, to, ...extraParams],
      ),
    ]);

    // Competitors cohort: every record where the customer is considering a
    // competitor vehicle. Brand + reason breakdowns are scoped to this cohort
    // (i.e. we don't count "no competitor" rows in the per-brand totals).
    const competitorYesWhere = `
      ${baseWhere}
        AND JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.answer') = 'yes'`;

    const competitorBrandRows = await this.insightsRepo.manager.query<
      Array<{ brand: string; count: string }>
    >(
      `SELECT
        JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.competitor_brand') AS brand,
        COUNT(1) AS count
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      ${competitorYesWhere}
        AND JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.competitor_brand') IS NOT NULL
        AND JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.competitor_brand') <> ''
      GROUP BY JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.competitor_brand')
      ORDER BY COUNT(1) DESC`,
      [from, to, ...extraParams],
    );

    // competitor_reasons.reasons is an array — need OPENJSON to unnest it.
    const competitorReasonRows = await this.insightsRepo.manager.query<
      Array<{ reason: string; count: string }>
    >(
      `SELECT reason.value AS reason, COUNT(1) AS count
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      CROSS APPLY OPENJSON(ii.campaign_answers_json, '$.competitor_reasons.reasons') AS reason
      ${competitorYesWhere}
      GROUP BY reason.value
      ORDER BY COUNT(1) DESC`,
      [from, to, ...extraParams],
    );

    const [competitorVehicleRows] = await Promise.all([
      this.insightsRepo.manager.query<Array<{ answer: string; count: string }>>(
        breakdownSql('$.competitor_vehicle.answer'),
        [from, to, ...extraParams],
      ),
    ]);

    // Customer views — each view now records a yes/no "negative view expressed"
    // answer (yes = the customer raised a negative view of that item), bucketed
    // the same way as the other yes/no questions.
    const viewPaths = [
      { key: 'brand', path: '$.view_on_brand.answer' },
      { key: 'current_vehicle', path: '$.view_on_current_vehicle.answer' },
      { key: 'dealer', path: '$.view_on_dealer.answer' },
      { key: 'finance_agreement', path: '$.view_on_finance_agreement.answer' },
    ] as const;

    const viewBreakdownRows = await Promise.all(
      viewPaths.map(({ path }) =>
        this.insightsRepo.manager.query<Array<{ answer: string; count: string }>>(
          breakdownSql(path),
          [from, to, ...extraParams],
        ),
      ),
    );

    const toBucket = (rows: Array<{ answer: string; count: string }>) => {
      const out = { yes: 0, no: 0, n_a: 0, missing: 0 };
      for (const r of rows) {
        const n = parseInt(r.count, 10);
        if (r.answer === 'yes') out.yes += n;
        else if (r.answer === 'no') out.no += n;
        else if (r.answer === '__missing' || r.answer == null) out.missing += n;
        else out.n_a += n; // covers 'n/a', 'n_a', and any unexpected label
      }
      return out;
    };

    const competitorBreakdown = toBucket(competitorVehicleRows);

    const views = viewPaths.reduce(
      (acc, { key }, i) => {
        acc[key] = toBucket(viewBreakdownRows[i]!);
        return acc;
      },
      {} as Record<string, ReturnType<typeof toBucket>>,
    );

    // "Any negative view" — distinct interactions where the customer raised a
    // negative view on AT LEAST ONE of brand / current vehicle / dealer / finance.
    // Counted with OR (not summed) so a customer negative on multiple areas is
    // counted once — i.e. a true rate of customers, not a count of flags.
    const anyNegativeViewRows = await this.insightsRepo.manager.query<
      Array<{ count: string }>
    >(
      `SELECT COUNT(1) AS count
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       ${baseWhere}
         AND (
           JSON_VALUE(ii.campaign_answers_json, '$.view_on_brand.answer') = 'yes'
           OR JSON_VALUE(ii.campaign_answers_json, '$.view_on_current_vehicle.answer') = 'yes'
           OR JSON_VALUE(ii.campaign_answers_json, '$.view_on_dealer.answer') = 'yes'
           OR JSON_VALUE(ii.campaign_answers_json, '$.view_on_finance_agreement.answer') = 'yes'
         )`,
      [from, to, ...extraParams],
    );
    const anyNegativeView = parseInt(anyNegativeViewRows[0]?.count ?? '0', 10);

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      total,
      any_negative_view: anyNegativeView,
      consent: toBucket(consentRows),
      decision_made: toBucket(decisionRows),
      dealer_already_in_touch: toBucket(dealerTouchRows),
      customer_situation: {
        affordability_issues: toBucket(affordabilityRows),
        lifestyle_change_vehicle: toBucket(lifestyleVehicleRows),
      },
      views,
      competitors: {
        breakdown: competitorBreakdown,
        total_with_competitor: competitorBreakdown.yes,
        competitor_brands: competitorBrandRows.map((r) => ({
          brand: r.brand,
          count: parseInt(r.count, 10),
        })),
        competitor_reasons: competitorReasonRows.map((r) => ({
          reason: r.reason,
          count: parseInt(r.count, 10),
        })),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PARITY: DRILL-DOWN INTERACTIONS
  // Returns interactions filtered by any combination of campaign_answers fields.
  // Each row includes outcome + a few projected Q&A flags so the UI can show
  // them inline without a second round-trip.
  // ─────────────────────────────────────────────────────────────────────────────

  async getParityInteractions(
    from: Date,
    to: Date,
    filterKey: InteractionFilter = 'calls',
    criteria: {
      consentAnswer?: 'yes' | 'no' | 'n_a';
      decisionAnswer?: 'yes' | 'no' | 'n_a';
      dealerInTouch?: 'yes' | 'no' | 'n_a';
      competitorBrand?: string;
      competitorReason?: string;
      viewKey?: 'brand' | 'current_vehicle' | 'dealer' | 'finance_agreement';
      viewAnswer?: 'yes' | 'no' | 'n_a';
      affordabilityAnswer?: 'yes' | 'no' | 'n_a';
      lifestyleVehicleAnswer?: 'yes' | 'no' | 'n_a';
    },
    limit = 200,
    offset = 0,
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string, vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(
      filterKey,
      campaign,
      agent,
      excludeOutcomes,
      vehicleMake,
      vehicleModels,
    );

    const params: unknown[] = [from, to, ...extraParams];
    const conds: string[] = [];

    // Translate the UI's "n_a" into the answer values the model actually emits.
    // The Parity prompt emits "n/a" — but be permissive and match both forms.
    const answerSet = (val: 'yes' | 'no' | 'n_a') =>
      val === 'n_a' ? `('n/a', 'n_a')` : `('${val}')`;

    if (criteria.consentAnswer) {
      conds.push(
        `JSON_VALUE(ii.campaign_answers_json, '$.consent_to_dealer.answer') IN ${answerSet(criteria.consentAnswer)}`,
      );
    }
    if (criteria.decisionAnswer) {
      conds.push(
        `JSON_VALUE(ii.campaign_answers_json, '$.decision_made.answer') IN ${answerSet(criteria.decisionAnswer)}`,
      );
    }
    if (criteria.dealerInTouch) {
      conds.push(
        `JSON_VALUE(ii.campaign_answers_json, '$.dealer_already_in_touch.answer') IN ${answerSet(criteria.dealerInTouch)}`,
      );
    }
    if (criteria.competitorBrand) {
      params.push(criteria.competitorBrand);
      conds.push(
        `JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.competitor_brand') = @${params.length - 1}`,
      );
    }
    if (criteria.competitorReason) {
      // Match any row whose competitor_reasons.reasons array contains the value.
      params.push(criteria.competitorReason);
      conds.push(
        `EXISTS (
          SELECT 1
          FROM OPENJSON(ii.campaign_answers_json, '$.competitor_reasons.reasons') AS r
          WHERE r.value = @${params.length - 1}
        )`,
      );
    }

    if (criteria.affordabilityAnswer) {
      conds.push(
        `JSON_VALUE(ii.campaign_answers_json, '$.affordability_issues.answer') IN ${answerSet(criteria.affordabilityAnswer)}`,
      );
    }
    if (criteria.lifestyleVehicleAnswer) {
      conds.push(
        `JSON_VALUE(ii.campaign_answers_json, '$.lifestyle_change_vehicle.answer') IN ${answerSet(criteria.lifestyleVehicleAnswer)}`,
      );
    }

    if (criteria.viewKey && criteria.viewAnswer) {
      const viewPath: Record<typeof criteria.viewKey, string> = {
        brand: '$.view_on_brand',
        current_vehicle: '$.view_on_current_vehicle',
        dealer: '$.view_on_dealer',
        finance_agreement: '$.view_on_finance_agreement',
      };
      const path = viewPath[criteria.viewKey];
      conds.push(
        `JSON_VALUE(ii.campaign_answers_json, '${path}.answer') IN ${answerSet(criteria.viewAnswer)}`,
      );
    }

    const extraConds = conds.length ? ' AND ' + conds.join(' AND ') : '';

    params.push(offset, limit);
    const offsetIdx = params.length - 2;
    const limitIdx = params.length - 1;

    const rows = await this.insightsRepo.manager.query(
      `SELECT
          ii.recordingId,
          ii.summary_short,
          ii.overall_score,
          ii.contact_disposition,
          ii.sentiment_overall,
          COALESCE(NULLIF(ia.dealer, ''), ii.dealer_name) AS dealer_name,
          CASE WHEN NULLIF(ia.dealer, '') IS NULL THEN 1 ELSE 0 END AS dealer_inferred,
          ia.agent,
          ia.interactionDateTime,
          ia.campaign,
          ia.outcome,
          ia.interactionTpsId,
          JSON_VALUE(ii.campaign_answers_json, '$.consent_to_dealer.answer') AS consent_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.consent_to_dealer.quote') AS consent_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.decision_made.answer') AS decision_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.decision_made.detail') AS decision_detail,
          JSON_VALUE(ii.campaign_answers_json, '$.decision_made.quote') AS decision_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.dealer_already_in_touch.answer') AS dealer_touch_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.competitor_brand') AS competitor_brand,
          JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.competitor_model') AS competitor_model,
          JSON_VALUE(ii.campaign_answers_json, '$.competitor_vehicle.quote') AS competitor_vehicle_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.competitor_reasons.detail') AS competitor_reasons_detail,
          JSON_VALUE(ii.campaign_answers_json, '$.competitor_reasons.quote') AS competitor_reasons_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_brand.answer') AS view_brand_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_brand.summary') AS view_brand_summary,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_brand.quote') AS view_brand_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_current_vehicle.answer') AS view_vehicle_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_current_vehicle.summary') AS view_vehicle_summary,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_current_vehicle.quote') AS view_vehicle_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_dealer.answer') AS view_dealer_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_dealer.summary') AS view_dealer_summary,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_dealer.quote') AS view_dealer_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_finance_agreement.answer') AS view_finance_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_finance_agreement.summary') AS view_finance_summary,
          JSON_VALUE(ii.campaign_answers_json, '$.view_on_finance_agreement.quote') AS view_finance_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.affordability_issues.answer') AS affordability_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.affordability_issues.detail') AS affordability_detail,
          JSON_VALUE(ii.campaign_answers_json, '$.affordability_issues.quote') AS affordability_quote,
          JSON_VALUE(ii.campaign_answers_json, '$.lifestyle_change_vehicle.answer') AS lifestyle_vehicle_answer,
          JSON_VALUE(ii.campaign_answers_json, '$.lifestyle_change_vehicle.detail') AS lifestyle_vehicle_detail,
          JSON_VALUE(ii.campaign_answers_json, '$.lifestyle_change_vehicle.quote') AS lifestyle_vehicle_quote
       FROM app.interaction_insights ii
       INNER JOIN app.interactions ia ON ia.id = ii.recordingId
       WHERE ii.campaign_answers_json IS NOT NULL
         AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
         AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
         ${filterClause}
         ${extraConds}
       ORDER BY ia.interactionDateTime DESC
       OFFSET @${offsetIdx} ROWS FETCH NEXT @${limitIdx} ROWS ONLY`,
      params,
    );

    return rows;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INSIGHTS TOKEN USAGE & COST
  // Aggregates per-record token usage (captured at extraction time) so spend can
  // be monitored in-app without logging into provider consoles. Surfaces the
  // retry overhead (records that needed >1 attempt + the tokens those wasted).
  // ─────────────────────────────────────────────────────────────────────────
  async getInsightsUsage(
    from: Date,
    to: Date,
    filterKey: InteractionFilter = 'calls',
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
    vehicleMake?: string,
    vehicleModels?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(
      filterKey, campaign, agent, excludeOutcomes, vehicleMake, vehicleModels,
    );

    const rows = await this.insightsRepo.manager.query<
      Array<{
        provider: string | null;
        model: string | null;
        records: string;
        measured_records: string;
        retried_records: string;
        input_tokens: string;
        output_tokens: string;
        failed_input_tokens: string;
        failed_output_tokens: string;
      }>
    >(
      `SELECT
        ii.providerUsed AS provider,
        ii.model AS model,
        COUNT(1) AS records,
        SUM(CASE WHEN ii.insight_output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS measured_records,
        SUM(CASE WHEN ii.insight_attempts > 1 THEN 1 ELSE 0 END) AS retried_records,
        SUM(ISNULL(ii.insight_input_tokens, 0)) AS input_tokens,
        SUM(ISNULL(ii.insight_output_tokens, 0)) AS output_tokens,
        SUM(ISNULL(ii.insight_failed_input_tokens, 0)) AS failed_input_tokens,
        SUM(ISNULL(ii.insight_failed_output_tokens, 0)) AS failed_output_tokens
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
        AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
        ${filterClause}
      GROUP BY ii.providerUsed, ii.model
      ORDER BY SUM(ISNULL(ii.insight_output_tokens, 0)) DESC`,
      [from, to, ...extraParams],
    );

    const prices = loadModelPrices();
    const currency = process.env.INSIGHTS_PRICES_CURRENCY ?? 'USD';
    const cost = (model: string | null, inTok: number, outTok: number) => {
      const p = model ? prices[model] : undefined;
      if (!p) return null;
      return (inTok * p.in + outTok * p.out) / 1_000_000;
    };

    const unpricedModels = new Set<string>();
    const byModel = rows.map((r) => {
      const inTok = parseInt(r.input_tokens, 10) || 0;
      const outTok = parseInt(r.output_tokens, 10) || 0;
      const failInTok = parseInt(r.failed_input_tokens, 10) || 0;
      const failOutTok = parseInt(r.failed_output_tokens, 10) || 0;
      const estCost = cost(r.model, inTok, outTok);
      const estWastedCost = cost(r.model, failInTok, failOutTok);
      if (estCost === null && r.model) unpricedModels.add(r.model);
      return {
        provider: r.provider,
        model: r.model,
        records: parseInt(r.records, 10) || 0,
        measured_records: parseInt(r.measured_records, 10) || 0,
        retried_records: parseInt(r.retried_records, 10) || 0,
        input_tokens: inTok,
        output_tokens: outTok,
        failed_input_tokens: failInTok,
        failed_output_tokens: failOutTok,
        total_tokens: inTok + outTok,
        wasted_tokens: failInTok + failOutTok,
        priced: estCost !== null,
        est_cost: estCost,
        est_wasted_cost: estWastedCost,
      };
    });

    const sum = (k: keyof (typeof byModel)[number]) =>
      byModel.reduce((a, b) => a + (Number(b[k]) || 0), 0);
    const measured = sum('measured_records');
    const retried = sum('retried_records');

    // Complete spend from the per-attempt log — includes retries AND fully-failed
    // records (which never produce an interaction_insights row). Joined to
    // interactions so the date/filter window matches the per-record view. Guarded
    // so the endpoint still works before the llm_usage_log migration is applied.
    let allAttempts: {
      records: number;
      attempt_count: number;
      failed_attempts: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      est_cost: number;
    } | null = null;
    try {
      const logRows = await this.insightsRepo.manager.query<
        Array<{
          model: string | null;
          input_tokens: string;
          output_tokens: string;
          attempt_count: string;
          failed_attempts: string;
          records: string;
        }>
      >(
        `SELECT lg.model AS model,
          SUM(lg.inputTokens) AS input_tokens,
          SUM(lg.outputTokens) AS output_tokens,
          COUNT(1) AS attempt_count,
          SUM(CASE WHEN lg.outcome <> 'success' THEN 1 ELSE 0 END) AS failed_attempts,
          COUNT(DISTINCT lg.recordingId) AS records
        FROM app.llm_usage_log lg
        INNER JOIN app.interactions ia ON ia.id = lg.recordingId
        WHERE COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
          AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
          ${filterClause}
        GROUP BY lg.model`,
        [from, to, ...extraParams],
      );
      const agg = {
        records: 0,
        attempt_count: 0,
        failed_attempts: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        est_cost: 0,
      };
      for (const r of logRows) {
        const i = parseInt(r.input_tokens, 10) || 0;
        const o = parseInt(r.output_tokens, 10) || 0;
        agg.input_tokens += i;
        agg.output_tokens += o;
        agg.total_tokens += i + o;
        agg.attempt_count += parseInt(r.attempt_count, 10) || 0;
        agg.failed_attempts += parseInt(r.failed_attempts, 10) || 0;
        agg.records += parseInt(r.records, 10) || 0;
        const c = cost(r.model, i, o);
        if (c !== null) agg.est_cost += c;
      }
      allAttempts = agg;
    } catch {
      allAttempts = null;
    }

    // Transcription spend (priced per audio-minute) from transcription_usage_log,
    // joined to interactions for the same window/filters. Guarded so it returns
    // null until that migration is applied.
    const txPrices = loadTranscriptionPrices();
    let transcription: {
      transcriptions: number;
      successes: number;
      audio_seconds: number;
      audio_minutes: number;
      est_cost: number;
      by_model: Array<Record<string, any>>;
      unpriced_models: string[];
    } | null = null;
    try {
      const txRows = await this.insightsRepo.manager.query<
        Array<{
          provider: string | null;
          model: string | null;
          transcriptions: string;
          successes: string;
          audio_seconds: string;
          measured: string;
        }>
      >(
        `SELECT t.provider AS provider, t.model AS model,
          COUNT(1) AS transcriptions,
          SUM(CASE WHEN t.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
          SUM(ISNULL(t.audioSeconds, 0)) AS audio_seconds,
          SUM(CASE WHEN t.audioSeconds IS NOT NULL THEN 1 ELSE 0 END) AS measured
        FROM app.transcription_usage_log t
        INNER JOIN app.interactions ia ON ia.id = t.recordingId
        WHERE COALESCE(ia.interactionDateTime, ia.createdAt) >= @0
          AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1
          ${filterClause}
        GROUP BY t.provider, t.model`,
        [from, to, ...extraParams],
      );
      const txUnpriced = new Set<string>();
      const byModel = txRows.map((r) => {
        const secs = parseFloat(r.audio_seconds) || 0;
        const perMin = r.model ? txPrices[r.model] : undefined;
        const estCost = perMin != null ? (secs / 60) * perMin : null;
        if (perMin == null && r.model) txUnpriced.add(r.model);
        return {
          provider: r.provider,
          model: r.model,
          transcriptions: parseInt(r.transcriptions, 10) || 0,
          successes: parseInt(r.successes, 10) || 0,
          measured: parseInt(r.measured, 10) || 0,
          audio_seconds: Math.round(secs),
          audio_minutes: Math.round((secs / 60) * 10) / 10,
          priced: estCost !== null,
          est_cost: estCost,
        };
      });
      const totSecs = byModel.reduce((a, b) => a + b.audio_seconds, 0);
      transcription = {
        transcriptions: byModel.reduce((a, b) => a + b.transcriptions, 0),
        successes: byModel.reduce((a, b) => a + b.successes, 0),
        audio_seconds: totSecs,
        audio_minutes: Math.round((totSecs / 60) * 10) / 10,
        est_cost: byModel.reduce((a, b) => a + (b.est_cost ?? 0), 0),
        by_model: byModel,
        unpriced_models: [...txUnpriced],
      };
    } catch {
      transcription = null;
    }

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      filter: filterKey,
      currency,
      totals: {
        records: sum('records'),
        measured_records: measured,
        retried_records: retried,
        retry_rate: measured ? Math.round((retried / measured) * 1000) / 10 : 0,
        input_tokens: sum('input_tokens'),
        output_tokens: sum('output_tokens'),
        total_tokens: sum('total_tokens'),
        wasted_tokens: sum('wasted_tokens'),
        est_cost: byModel.reduce((a, b) => a + (b.est_cost ?? 0), 0),
        est_wasted_cost: byModel.reduce((a, b) => a + (b.est_wasted_cost ?? 0), 0),
      },
      by_model: byModel,
      // Complete spend incl. retries + fully-failed records (null until migration applied).
      all_attempts: allAttempts,
      // Transcription spend (Deepgram + OpenAI), priced per audio-minute. null
      // until the transcription_usage_log migration is applied.
      transcription,
      // Models with no price in the table — their tokens count but cost is excluded.
      unpriced_models: [...unpricedModels],
    };
  }

  async getInteractionDetail(recordingId: string) {
    const interaction = await this.recordingsRepo.findOne({ where: { id: recordingId } });
    if (!interaction) return null;

    const insight = await this.insightsRepo.findOne({ where: { recordingId } });

    const transcript = await this.transcriptsRepo.findOne({ where: { recordingId } });

    // Survey records get an extra projected block so the shared drawer can render
    // the full survey answer set + mined transcript insights (same shape as the
    // survey dashboard's own detail endpoint). Null for non-survey interactions.
    const survey =
      insight?.conversation_type === 'survey'
        ? buildSurveyDetail(
            insight.campaign_answers_json
              ? safeParseJson(insight.campaign_answers_json)
              : {},
            insight.campaign_transcript_json
              ? safeParseJson(insight.campaign_transcript_json)
              : null,
            {
              id: interaction.id,
              interaction_id: interaction.id,
              interaction_tps_id: interaction.interactionTpsId,
              campaign: interaction.campaign,
              manufacture: interaction.vehicleMake,
              model: interaction.vehicleModel,
              dealer: interaction.dealer,
              allocation_date: interaction.interactionDateTime,
              outcome: interaction.outcome,
              recordingUrl: interaction.recordingUrl,
              transcript_text: transcript?.text ?? null,
              transcript_model: transcript?.model ?? null,
            },
          )
        : null;

    return {
      survey,
      interaction: {
        id: interaction.id,
        agent: interaction.agent,
        campaign: interaction.campaign,
        interactionType: interaction.interactionType,
        interactionDateTime: interaction.interactionDateTime?.toISOString() ?? null,
        status: interaction.status,
        interactionId: interaction.interactionId,
        interactionTpsId: interaction.interactionTpsId,
        interactionSource: interaction.interactionSource,
        recordingUrl: interaction.recordingUrl,
        outcome: interaction.outcome,
      },
      transcript: transcript
        ? {
            text: transcript.text,
            model: transcript.model,
            confidence: transcript.confidence ?? null,
            word_count: transcript.wordCount ?? null,
            uncertain_word_count: transcript.uncertainWordCount ?? null,
            // % of words the ASR engine was unsure of — a wider, more comparable
            // signal than the compressed overall confidence.
            uncertain_pct:
              transcript.wordCount && transcript.uncertainWordCount != null
                ? Math.round((transcript.uncertainWordCount / transcript.wordCount) * 1000) / 10
                : null,
            low_confidence: transcript.lowConfidenceJson
              ? safeParseJson(transcript.lowConfidenceJson)
              : null,
          }
        : null,
      insight: insight ? (() => {
        // Extract operations.scoring_flags from the raw LLM JSON — not stored
        // in operations_scores_json, but lives inside the full `json` blob.
        const raw = insight.json ? safeParseJson(insight.json) : null;
        const operationsFlags = raw?.operations?.scoring_flags ?? null;

        // Source dealer (from interactions) wins; fall back to LLM-extracted.
        // dealer_inferred flags when the shown value came from the model.
        const sourceDealer = interaction.dealer?.trim() ? interaction.dealer : null;

        const campaignAnswers = insight.campaign_answers_json
          ? safeParseJson(insight.campaign_answers_json)
          : null;

        return {
          summary_short: insight.summary_short,
          summary_detailed: insight.summary_detailed,
          sentiment_overall: insight.sentiment_overall,
          overall_score: insight.overall_score,
          contact_disposition: insight.contact_disposition,
          conversation_type: insight.conversation_type,
          interest_level: insight.interest_level,
          campaign_detected: insight.campaign_detected,
          dealer_name: sourceDealer ?? insight.dealer_name,
          dealer_inferred: !sourceDealer && !!insight.dealer_name,
          decision_timeline: insight.decision_timeline,
          next_step_agreed: insight.next_step_agreed,
          operations_scores: insight.operations_scores_json ? safeParseJson(insight.operations_scores_json) : null,
          operations_flags: operationsFlags,
          qa_scores: insight.qa_scores_json ? safeParseJson(insight.qa_scores_json) : null,
          coaching: insight.coaching_json ? safeParseJson(insight.coaching_json) : null,
          objections: insight.objections_json ? safeParseJson(insight.objections_json) : null,
          objection_assessment: insight.objection_assessments_json ? safeParseJson(insight.objection_assessments_json) : null,
          action_items: insight.action_items_json ? safeParseJson(insight.action_items_json) : null,
          risk_flags: insight.risk_flags_json ? safeParseJson(insight.risk_flags_json) : null,
          opportunity: {
            is_opportunity: insight.is_opportunity,
            not_opportunity_reason: insight.not_opportunity_reason,
            detail: insight.opportunity_json ? safeParseJson(insight.opportunity_json) : null,
          },
          campaign_answers: campaignAnswers,
          // Provenance: which model + prompt fragment versions produced this
          // insight, for reproducibility / audit.
          provenance: {
            provider_used: insight.providerUsed,
            model: insight.model,
            extractor_version: insight.extractorVersion,
            generated_at: insight.createdAt,
            prompt_versions: insight.prompt_versions_json
              ? safeParseJson(insight.prompt_versions_json)
              : null,
          },
          // QA trust signal: are the model's verbatim quotes actually in the transcript?
          quote_grounding: verifyCampaignQuotes(transcript?.text ?? null, campaignAnswers),
          chat_response:
            insight.chat_response_measured_count !== null ||
            insight.chat_response_metrics_json
              ? {
                  avg_seconds: insight.chat_response_avg_seconds,
                  longest_seconds: insight.chat_response_longest_seconds,
                  last_seconds: insight.chat_response_last_seconds,
                  sla_breach_count: insight.chat_response_sla_breach_count,
                  measured_count: insight.chat_response_measured_count,
                  sla_threshold_seconds: this.CHAT_RESPONSE_SLA_SECONDS,
                  sla_breached: (insight.chat_response_sla_breach_count ?? 0) > 0,
                  pairs: insight.chat_response_metrics_json
                    ? safeParseJson(insight.chat_response_metrics_json)?.pairs ?? null
                    : null,
                }
              : null,
        };
      })() : null,
    };
  }

  async listNarratives(opts: {
    limit: number;
    filterKey?: InteractionFilter;
    provider?: InsightsProviderName;
    narrativeType?: NarrativeType;
    createdFrom?: Date;
    createdTo?: Date;
  }) {
    const qb = this.summariesRepo
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .take(opts.limit);

    if (opts.filterKey) {
      qb.andWhere('s.filterKey LIKE :fk', { fk: `${opts.filterKey}%` });
    }
    if (opts.provider) {
      qb.andWhere('s.filterKey LIKE :prov', { prov: `%__${opts.provider}__%` });
    }
    if (opts.narrativeType) {
      qb.andWhere('s.narrativeType = :nt', { nt: opts.narrativeType });
    }
    if (opts.createdFrom) {
      qb.andWhere('s.createdAt >= :createdFrom', { createdFrom: opts.createdFrom });
    }
    if (opts.createdTo) {
      qb.andWhere('s.createdAt < :createdTo', { createdTo: opts.createdTo });
    }

    const rows = await qb.getMany();

    return rows.map((r) => {
      const parts = (r.filterKey ?? '').split('__');
      return {
        id: r.id,
        from: r.fromUtc.toISOString(),
        to: r.toUtc.toISOString(),
        filterKey: parts[0] || 'all',
        narrativeType: r.narrativeType,
        providerUsed: parts[1] || null,
        campaign: parts[2] && parts[2] !== 'all' ? parts[2] : null,
        agent: parts[3] && parts[3] !== 'all' ? parts[3] : null,
        createdAt: r.createdAt.toISOString(),
        model: r.model,
        narrative: r.narrativeJson ? safeParseJson(r.narrativeJson) : null,
        metrics: r.metricsJson ? safeParseJson(r.metricsJson) : null,
      };
    });
  }
}
