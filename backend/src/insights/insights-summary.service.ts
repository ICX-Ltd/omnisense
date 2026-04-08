import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { InsightSummary } from '../db/entities/insight-summary.entity';
import { SurveyResponse } from '../db/entities/survey-response.entity';

import { createProvider } from './providers/provider.factory';
import { InsightsProviderName } from './types/insights-provider.type';
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

export interface FilterOptions {
  campaigns: string[];
  agents: string[];
  outcomes: string[];
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

    return {
      campaigns: campaigns.map((r) => r.campaign),
      agents: agents.map((r) => r.agent),
      outcomes: outcomes.map((r) => r.outcome),
    };
  }

  private applyFilters<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    filterKey: string,
    campaign?: string,
    agent?: string,
    excludeOutcomes?: string[],
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

    const clause = parts.length ? 'AND ' + parts.join(' AND ') : '';
    return { clause, extraParams };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERAL METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getMetricsSummary(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[]) {
    const dateWhere = 'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };

    const baseQb = () =>
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams);

    const totals = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select('COUNT(1)', 'total_calls')
      .addSelect('AVG(ii.sentiment_overall)', 'avg_sentiment')
      .getRawOne<{ total_calls: string; avg_sentiment: number | null }>();

    const byCampaign = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select("COALESCE(ii.campaign_detected, 'unknown')", 'campaign_detected')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.campaign_detected, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ campaign_detected: string; count: string }>();

    const byScore = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select('AVG(ii.overall_score)', 'avg_score')
      .addSelect('MIN(ii.overall_score)', 'min_score')
      .addSelect('MAX(ii.overall_score)', 'max_score')
      .andWhere('ii.overall_score IS NOT NULL')
      .getRawOne<{ avg_score: number | null; min_score: number | null; max_score: number | null }>();

    const connectedDispositionFilter = `ii.contact_disposition NOT IN ('no_answer', 'voicemail', 'busy', 'call_dropped', 'invalid_number')`;

    const worstSentiment = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
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

    const byContact = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select(
        "COALESCE(ii.contact_disposition, 'unknown')",
        'contact_disposition',
      )
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.contact_disposition, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ contact_disposition: string; count: string }>();

    const byConversationType = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select("COALESCE(ii.conversation_type, 'unknown')", 'conversation_type')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.conversation_type, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ conversation_type: string; count: string }>();

    const byInterest = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select("COALESCE(ii.interest_level, 'unknown')", 'interest_level')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.interest_level, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ interest_level: string; count: string }>();

    const leadGenerated = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select(
        'SUM(CASE WHEN ii.lead_generated_for_dealer = 1 THEN 1 ELSE 0 END)',
        'count_true',
      )
      .addSelect('COUNT(1)', 'total')
      .getRawOne<{ count_true: string; total: string }>();

    const bestSentiment = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
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

    const dealerFollowups = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        'ii.dealer_name AS dealer_name',
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

  async getOperationsMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[]) {
    const dateWhere = 'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);

    const baseQb = () =>
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams);

    const scoreStats = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select('AVG(ii.overall_score)', 'avg_score')
      .addSelect('MIN(ii.overall_score)', 'min_score')
      .addSelect('MAX(ii.overall_score)', 'max_score')
      .addSelect('SUM(CASE WHEN ii.overall_score IS NOT NULL THEN 1 ELSE 0 END)', 'scored_count')
      .addSelect('COUNT(1)', 'total_count')
      .getRawOne<{ avg_score: number | null; min_score: number | null; max_score: number | null; scored_count: string; total_count: string }>();

    const scoreBuckets = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select(
        `CASE WHEN ii.overall_score < 5 THEN 'below_5' WHEN ii.overall_score < 7 THEN '5_to_7' WHEN ii.overall_score < 9 THEN '7_to_9' ELSE '9_plus' END`,
        'bucket',
      )
      .addSelect('COUNT(1)', 'count')
      .andWhere('ii.overall_score IS NOT NULL')
      .groupBy(`CASE WHEN ii.overall_score < 5 THEN 'below_5' WHEN ii.overall_score < 7 THEN '5_to_7' WHEN ii.overall_score < 9 THEN '7_to_9' ELSE '9_plus' END`)
      .getRawMany<{ bucket: string; count: string }>();

    // Per-dimension averages using JSON_VALUE (calls + chats)
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
        ${filterClause}`,
      [from, to, ...extraParams],
    );

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

    const outcomeDistribution = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select("COALESCE(ia.outcome, 'unknown')", 'outcome')
      .addSelect('COUNT(1)', 'count')
      .addSelect('AVG(ii.overall_score)', 'avg_score')
      .groupBy("COALESCE(ia.outcome, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ outcome: string; count: string; avg_score: number | null }>();

    const lowestScored = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
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
      top_coaching_needs: topCoachingNeeds,
      lowest_scored: lowestScored.map((r) => ({
        ...r,
        coaching_json: r.coaching_json ? safeParseJson(r.coaching_json as string) : null,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CLIENT SERVICES METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getClientServicesMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[]) {
    const dateWhere = 'COALESCE(ia.interactionDateTime, ia.createdAt) >= :from AND COALESCE(ia.interactionDateTime, ia.createdAt) < :to';
    const dateParams = { from, to };
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);

    const baseQb = () =>
      this.insightsRepo
        .createQueryBuilder('ii')
        .innerJoin(Interaction, 'ia', 'ia.id = ii.recordingId')
        .where(dateWhere, dateParams);

    const scalars = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select('COUNT(1)', 'total')
      .addSelect('SUM(CASE WHEN ii.lead_generated_for_dealer = 1 THEN 1 ELSE 0 END)', 'leads')
      .addSelect('SUM(CASE WHEN ii.is_in_market_now = 1 THEN 1 ELSE 0 END)', 'in_market')
      .addSelect('SUM(CASE WHEN ii.lost_sale = 1 THEN 1 ELSE 0 END)', 'lost_sales')
      .addSelect('SUM(CASE WHEN ii.has_purchased_elsewhere = 1 THEN 1 ELSE 0 END)', 'purchased_elsewhere')
      .getRawOne<{ total: string; leads: string; in_market: string; lost_sales: string; purchased_elsewhere: string }>();

    const topCompetitors = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
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

    const topDealers = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select("COALESCE(ii.dealer_name, 'unknown')", 'dealer_name')
      .addSelect('COUNT(1)', 'count')
      .andWhere('ii.lead_generated_for_dealer = 1')
      .groupBy("COALESCE(ii.dealer_name, 'unknown')")
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ dealer_name: string; count: string }>();

    const byInterest = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select("COALESCE(ii.interest_level, 'unknown')", 'interest_level')
      .addSelect('COUNT(1)', 'count')
      .groupBy("COALESCE(ii.interest_level, 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ interest_level: string; count: string }>();

    const recentLostSales = await this.applyFilters(baseQb(), filterKey, campaign, agent, excludeOutcomes)
      .select([
        'ii.recordingId AS recordingId',
        'ii.summary_short AS summary_short',
        'ii.competitor_purchased AS competitor_purchased',
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

  async getObjectionsMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[]) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);

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
  // CAMPAIGN COMPLIANCE METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  async getCampaignComplianceMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[]) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);

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
  ) {
    const selectedProvider =
      provider ??
      (process.env.INSIGHTS_PROVIDER as InsightsProviderName | undefined) ??
      'openai';

    const storedKey = [filterKey, selectedProvider, campaign ?? 'all', agent ?? 'all'].join('__');

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

    // Fetch the appropriate metrics and build the right prompt
    let metrics: unknown;
    let prompt: string;

    if (narrativeType === 'calls_operations') {
      metrics = await this.getOperationsMetrics(from, to, filterKey, campaign, agent, excludeOutcomes);
      prompt = buildCallsOperationsNarrativePrompt(metrics);
    } else if (narrativeType === 'calls_client_services') {
      metrics = await this.getClientServicesMetrics(from, to, filterKey, campaign, agent, excludeOutcomes);
      prompt = buildCallsClientServicesNarrativePrompt(metrics);
    } else if (narrativeType === 'chats_operations') {
      metrics = await this.getOperationsMetrics(from, to, filterKey, campaign, agent, excludeOutcomes);
      prompt = buildChatsOperationsNarrativePrompt(metrics);
    } else if (narrativeType === 'chats_client_services') {
      metrics = await this.getClientServicesMetrics(from, to, filterKey, campaign, agent, excludeOutcomes);
      prompt = buildChatsClientServicesNarrativePrompt(metrics);
    } else if (narrativeType === 'survey_analytics') {
      const surveyMetrics = await this.gatherSurveyMetricsForNarrative(from, to, campaign);
      metrics = surveyMetrics.aggregated;
      prompt = buildSurveyAnalyticsNarrativePrompt(surveyMetrics.aggregated, surveyMetrics.freeText);
    } else {
      metrics = await this.getMetricsSummary(from, to, filterKey, campaign, agent, excludeOutcomes);
      prompt = buildNarrativeSummaryPrompt(metrics);
    }

    const llmProvider = createProvider(selectedProvider);

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

  private async gatherSurveyMetricsForNarrative(from: Date, to: Date, campaign?: string) {
    const parts: string[] = ['s.allocation_date >= @0', 's.allocation_date < @1'];
    const params: any[] = [from, to];
    if (campaign) {
      parts.push(`s.campaign = @${params.length}`);
      params.push(campaign);
    }
    const where = 'WHERE ' + parts.join(' AND ');

    // Aggregated counts
    const totals = await this.surveyRepo.manager.query(
      `SELECT COUNT(1) AS total,
        SUM(CASE WHEN s.survey_flow_status = 'Survey Taken' THEN 1 ELSE 0 END) AS survey_taken,
        SUM(CASE WHEN s.positive_outcome = 1 THEN 1 ELSE 0 END) AS positive,
        SUM(CASE WHEN s.neutral_outcome = 1 THEN 1 ELSE 0 END) AS neutral,
        SUM(CASE WHEN s.negative_outcome = 1 THEN 1 ELSE 0 END) AS negative
      FROM app.survey_responses s ${where}`, params,
    );

    const categories = await this.surveyRepo.manager.query(
      `SELECT COALESCE(s.result_code_desc, 'Unknown') AS category, COUNT(1) AS count
       FROM app.survey_responses s ${where} GROUP BY s.result_code_desc ORDER BY COUNT(1) DESC`, params,
    );

    const interestFactors = await this.surveyRepo.manager.query(
      `SELECT
        SUM(CAST(ISNULL(s.initial_interest_styling, 0) AS INT)) AS styling,
        SUM(CAST(ISNULL(s.initial_interest_brand, 0) AS INT)) AS brand,
        SUM(CAST(ISNULL(s.initial_interest_features, 0) AS INT)) AS features,
        SUM(CAST(ISNULL(s.initial_interest_size, 0) AS INT)) AS size,
        SUM(CAST(ISNULL(s.initial_interest_performance, 0) AS INT)) AS performance,
        SUM(CAST(ISNULL(s.initial_interest_price, 0) AS INT)) AS price
      FROM app.survey_responses s ${where} AND s.survey_flow_status = 'Survey Taken'`, params,
    );

    const notPurchaseReasons = await this.surveyRepo.manager.query(
      `SELECT
        SUM(CAST(ISNULL(s.not_purchased_price, 0) AS INT)) AS price,
        SUM(CAST(ISNULL(s.not_purchased_expectations, 0) AS INT)) AS expectations,
        SUM(CAST(ISNULL(s.not_purchased_different_brand, 0) AS INT)) AS different_brand,
        SUM(CAST(ISNULL(s.not_purchased_different_model, 0) AS INT)) AS different_model,
        SUM(CAST(ISNULL(s.not_purchased_financing, 0) AS INT)) AS financing,
        SUM(CAST(ISNULL(s.not_purchased_dealership, 0) AS INT)) AS dealership
      FROM app.survey_responses s ${where} AND s.survey_flow_status = 'Survey Taken'`, params,
    );

    const competitorPurchases = await this.surveyRepo.manager.query(
      `SELECT s.purchased_make AS make, COUNT(1) AS count
       FROM app.survey_responses s ${where} AND s.purchased_make IS NOT NULL AND s.purchased_make != ''
       GROUP BY s.purchased_make ORDER BY COUNT(1) DESC`, params,
    );

    const dealerRatings = await this.surveyRepo.manager.query(
      `SELECT s.dealer, AVG(CAST(s.dealership_rating AS FLOAT)) AS avg_rating, COUNT(1) AS count
       FROM app.survey_responses s ${where} AND s.dealership_rating IS NOT NULL AND s.dealer IS NOT NULL
       GROUP BY s.dealer HAVING COUNT(1) >= 2 ORDER BY AVG(CAST(s.dealership_rating AS FLOAT)) ASC`, params,
    );

    const modelPerformance = await this.surveyRepo.manager.query(
      `SELECT s.model, COUNT(1) AS total,
        SUM(CASE WHEN s.p2_still_considering = 'Yes' THEN 1 ELSE 0 END) AS still_considering,
        SUM(CASE WHEN s.purchased_make IS NOT NULL AND s.purchased_make != '' THEN 1 ELSE 0 END) AS purchased_elsewhere
      FROM app.survey_responses s ${where} AND s.model IS NOT NULL
      GROUP BY s.model HAVING COUNT(1) >= 2 ORDER BY COUNT(1) DESC`, params,
    );

    // Free-text samples (up to 100 records with any text content)
    const freeText = await this.surveyRepo.manager.query(
      `SELECT TOP 100
        s.id_opportunity, s.model, s.dealer, s.result_code_desc,
        s.agent_notes, s.dealership_rating_feedback, s.why_no_test_drive,
        s.not_purchased_price_feedback, s.purchase_influence, s.purchase_reason,
        s.improve_anything, s.vehicle_impression, s.purchased_make, s.purchased_model
      FROM app.survey_responses s ${where}
        AND (s.agent_notes IS NOT NULL OR s.dealership_rating_feedback IS NOT NULL
             OR s.why_no_test_drive IS NOT NULL OR s.not_purchased_price_feedback IS NOT NULL
             OR s.purchase_influence IS NOT NULL OR s.improve_anything IS NOT NULL)
      ORDER BY s.allocation_date DESC`, params,
    );

    return {
      aggregated: {
        totals: totals[0] ?? {},
        categories,
        interest_factors: interestFactors[0] ?? {},
        not_purchase_reasons: notPurchaseReasons[0] ?? {},
        competitor_purchases: competitorPurchases,
        dealer_ratings: dealerRatings.slice(0, 15),
        model_performance: modelPerformance.slice(0, 15),
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
    COUNT(1) AS count
  FROM app.interaction_insights ii
  INNER JOIN app.interactions ia ON ia.id = ii.recordingId
  WHERE JSON_VALUE(ii.qa_scores_json, '$.scores.correct_process.section_score') IS NOT NULL
    AND COALESCE(ia.interactionDateTime, ia.createdAt) >= @0 AND COALESCE(ia.interactionDateTime, ia.createdAt) < @1`;

  async getOpsDimensionComparison(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[],
  ) {
    // Overall averages (no agent filter)
    const { clause: overallClause, extraParams: overallParams } = this.buildRawFilters(filterKey, campaign, undefined, excludeOutcomes);
    const overall = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
      `${this.dimensionAvgSql} ${overallClause}`,
      [from, to, ...overallParams],
    );

    // RAC QA averages (overall, no agent filter)
    const qaOverall = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
      `${this.qaAvgSql} ${overallClause}`,
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
      const { clause: agentClause, extraParams: agentParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);
      const agentResult = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
        `${this.dimensionAvgSql} ${agentClause}`,
        [from, to, ...agentParams],
      );
      agentData = agentResult[0] ?? null;

      const qaAgentResult = await this.insightsRepo.manager.query<Array<Record<string, number | null>>>(
        `${this.qaAvgSql} ${agentClause}`,
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
  ) {
    const ranges: Record<string, [number, number]> = {
      below_5: [0, 5],
      '5_to_7': [5, 7],
      '7_to_9': [7, 9],
      '9_plus': [9, 10.01],
    };
    const range = ranges[bucket];
    if (!range) return [];

    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);
    const paramOffset = 2 + extraParams.length;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome
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
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);
    const paramOffset = 2 + extraParams.length;

    const rows = await this.insightsRepo.manager.query(
      `SELECT DISTINCT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome
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

  async getInteractionsByOutcome(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    outcome: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = outcome === 'unknown';
    const outcomeCondition = isUnknown
      ? `(ia.outcome IS NULL OR ia.outcome = '')`
      : `ia.outcome = @${paramOffset}`;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.coaching_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome
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
  // CLIENT SERVICES: INTERACTIONS BY INTEREST LEVEL
  // ─────────────────────────────────────────────────────────────────────────────

  async getInteractionsByInterestLevel(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    interestLevel: string, limit = 200, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = interestLevel === 'unknown';
    const condition = isUnknown
      ? `(ii.interest_level IS NULL OR ii.interest_level = '' OR ii.interest_level = 'unknown')`
      : `ii.interest_level = @${paramOffset}`;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.interest_level,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome
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
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);
    const paramOffset = 2 + extraParams.length;

    const isUnknown = competitor === 'unknown';
    const condition = isUnknown
      ? `(ii.competitor_purchased IS NULL OR ii.competitor_purchased = '' OR ii.competitor_purchased = 'unknown')`
      : `ii.competitor_purchased = @${paramOffset}`;

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.competitor_purchased,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome
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

  async getOpportunityMetrics(from: Date, to: Date, filterKey: InteractionFilter = 'calls', campaign?: string, agent?: string, excludeOutcomes?: string[]) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);

    const rows = await this.insightsRepo.manager.query<Array<{
      total: string;
      opportunities: string;
      not_opportunities: string;
      classified: string;
    }>>(
      `SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN ii.is_opportunity = 1 THEN 1 ELSE 0 END) AS opportunities,
        SUM(CASE WHEN ii.is_opportunity = 0 THEN 1 ELSE 0 END) AS not_opportunities,
        SUM(CASE WHEN ii.is_opportunity IS NOT NULL THEN 1 ELSE 0 END) AS classified
      FROM app.interaction_insights ii
      INNER JOIN app.interactions ia ON ia.id = ii.recordingId
      WHERE ii.is_opportunity IS NOT NULL
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
      reason_breakdown: reasonBreakdown.map((r) => ({
        reason: r.reason,
        count: parseInt(r.count, 10),
      })),
    };
  }

  async getInteractionsByOpportunityReason(
    from: Date, to: Date, filterKey: InteractionFilter = 'calls',
    reason: string, limit = 50, offset = 0, campaign?: string, agent?: string, excludeOutcomes?: string[],
  ) {
    const { clause: filterClause, extraParams } = this.buildRawFilters(filterKey, campaign, agent, excludeOutcomes);
    const paramOffset = 2 + extraParams.length;

    const isOpportunityFilter = reason === '__opportunity'
      ? `ii.is_opportunity = 1`
      : `ii.is_opportunity = 0 AND ii.not_opportunity_reason = @${paramOffset}`;
    const extraQueryParams = reason === '__opportunity' ? [] : [reason];

    const rows = await this.insightsRepo.manager.query(
      `SELECT ii.recordingId, ii.summary_short, ii.overall_score, ii.contact_disposition,
              ii.campaign_detected, ii.sentiment_overall, ii.is_opportunity,
              ii.not_opportunity_reason, ii.opportunity_json,
              ia.agent, ia.interactionDateTime, ia.campaign, ia.outcome
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

  async getInteractionDetail(recordingId: string) {
    const interaction = await this.recordingsRepo.findOne({ where: { id: recordingId } });
    if (!interaction) return null;

    const insight = await this.insightsRepo.findOne({ where: { recordingId } });

    const transcript = await this.transcriptsRepo.findOne({ where: { recordingId } });

    return {
      interaction: {
        id: interaction.id,
        agent: interaction.agent,
        campaign: interaction.campaign,
        interactionType: interaction.interactionType,
        interactionDateTime: interaction.interactionDateTime?.toISOString() ?? null,
        status: interaction.status,
        interactionId: interaction.interactionId,
        recordingUrl: interaction.recordingUrl,
        outcome: interaction.outcome,
      },
      transcript: transcript ? { text: transcript.text, model: transcript.model } : null,
      insight: insight ? {
        summary_short: insight.summary_short,
        summary_detailed: insight.summary_detailed,
        sentiment_overall: insight.sentiment_overall,
        overall_score: insight.overall_score,
        contact_disposition: insight.contact_disposition,
        conversation_type: insight.conversation_type,
        interest_level: insight.interest_level,
        campaign_detected: insight.campaign_detected,
        decision_timeline: insight.decision_timeline,
        next_step_agreed: insight.next_step_agreed,
        operations_scores: insight.operations_scores_json ? safeParseJson(insight.operations_scores_json) : null,
        qa_scores: insight.qa_scores_json ? safeParseJson(insight.qa_scores_json) : null,
        coaching: insight.coaching_json ? safeParseJson(insight.coaching_json) : null,
        objections: insight.objections_json ? safeParseJson(insight.objections_json) : null,
        action_items: insight.action_items_json ? safeParseJson(insight.action_items_json) : null,
        risk_flags: insight.risk_flags_json ? safeParseJson(insight.risk_flags_json) : null,
        opportunity: {
          is_opportunity: insight.is_opportunity,
          not_opportunity_reason: insight.not_opportunity_reason,
          detail: insight.opportunity_json ? safeParseJson(insight.opportunity_json) : null,
        },
      } : null,
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
