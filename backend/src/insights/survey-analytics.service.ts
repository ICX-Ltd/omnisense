import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SurveyResponse } from '../db/entities/survey-response.entity';

export type SurveyFilter = {
  from?: Date;
  to?: Date;
  campaign?: string;
  manufacture?: string;
  model?: string;
  dealer?: string;
  surveyTakenOnly?: boolean;
};

@Injectable()
export class SurveyAnalyticsService {
  constructor(
    @InjectRepository(SurveyResponse)
    private repo: Repository<SurveyResponse>,
  ) {}

  private buildWhere(f: SurveyFilter): { clause: string; params: any[] } {
    const parts: string[] = [];
    const params: any[] = [];
    let idx = 0;

    if (f.from) {
      parts.push(`s.allocation_date >= @${idx}`);
      params.push(f.from);
      idx++;
    }
    if (f.to) {
      parts.push(`s.allocation_date < @${idx}`);
      params.push(f.to);
      idx++;
    }
    if (f.campaign) {
      parts.push(`s.campaign = @${idx}`);
      params.push(f.campaign);
      idx++;
    }
    if (f.manufacture) {
      parts.push(`s.manufacture = @${idx}`);
      params.push(f.manufacture);
      idx++;
    }
    if (f.model) {
      parts.push(`s.model = @${idx}`);
      params.push(f.model);
      idx++;
    }
    if (f.dealer) {
      parts.push(`s.dealer = @${idx}`);
      params.push(f.dealer);
      idx++;
    }
    if (f.surveyTakenOnly) {
      parts.push(`s.survey_flow_status = 'Survey Taken'`);
    }

    return {
      clause: parts.length ? 'WHERE ' + parts.join(' AND ') : '',
      params,
    };
  }

  // ── Filter options ────────────────────────────────────────────────────────

  async getFilterOptions() {
    const campaigns = await this.repo.manager.query<Array<{ v: string }>>(
      `SELECT DISTINCT s.campaign AS v FROM app.survey_responses s WHERE s.campaign IS NOT NULL ORDER BY s.campaign`,
    );
    const manufactures = await this.repo.manager.query<Array<{ v: string }>>(
      `SELECT DISTINCT s.manufacture AS v FROM app.survey_responses s WHERE s.manufacture IS NOT NULL ORDER BY s.manufacture`,
    );
    const models = await this.repo.manager.query<Array<{ v: string }>>(
      `SELECT DISTINCT s.model AS v FROM app.survey_responses s WHERE s.model IS NOT NULL ORDER BY s.model`,
    );
    const dealers = await this.repo.manager.query<Array<{ v: string }>>(
      `SELECT DISTINCT s.dealer AS v FROM app.survey_responses s WHERE s.dealer IS NOT NULL ORDER BY s.dealer`,
    );

    return {
      campaigns: campaigns.map((r) => r.v),
      manufactures: manufactures.map((r) => r.v),
      models: models.map((r) => r.v),
      dealers: dealers.map((r) => r.v),
    };
  }

  // ── Overview metrics ──────────────────────────────────────────────────────

  async getOverview(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const totals = await this.repo.manager.query<Array<{
      total: string;
      survey_taken: string;
      survey_not_taken: string;
      positive: string;
      neutral: string;
      negative: string;
    }>>(
      `SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN s.survey_flow_status = 'Survey Taken' THEN 1 ELSE 0 END) AS survey_taken,
        SUM(CASE WHEN s.survey_flow_status = 'Survey Not Taken' THEN 1 ELSE 0 END) AS survey_not_taken,
        SUM(CASE WHEN s.positive_outcome = 1 THEN 1 ELSE 0 END) AS positive,
        SUM(CASE WHEN s.neutral_outcome = 1 THEN 1 ELSE 0 END) AS neutral,
        SUM(CASE WHEN s.negative_outcome = 1 THEN 1 ELSE 0 END) AS negative
      FROM app.survey_responses s ${clause}`,
      params,
    );

    const t = totals[0];
    return {
      total: parseInt(t?.total ?? '0', 10),
      survey_taken: parseInt(t?.survey_taken ?? '0', 10),
      survey_not_taken: parseInt(t?.survey_not_taken ?? '0', 10),
      positive: parseInt(t?.positive ?? '0', 10),
      neutral: parseInt(t?.neutral ?? '0', 10),
      negative: parseInt(t?.negative ?? '0', 10),
    };
  }

  // ── Category breakdown (Result Code Desc) ─────────────────────────────────

  async getCategoryBreakdown(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const rows = await this.repo.manager.query<Array<{ category: string; count: string }>>(
      `SELECT COALESCE(s.result_code_desc, 'Unknown') AS category, COUNT(1) AS count
       FROM app.survey_responses s ${clause}
       GROUP BY s.result_code_desc
       ORDER BY COUNT(1) DESC`,
      params,
    );

    return rows.map((r) => ({
      category: r.category,
      count: parseInt(r.count, 10),
    }));
  }

  // ── Initial interest factors ──────────────────────────────────────────────

  async getInterestFactors(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    // Only count rows where survey was taken and at least one interest flag is set
    const baseFilter = clause
      ? clause + ` AND s.survey_flow_status = 'Survey Taken'`
      : `WHERE s.survey_flow_status = 'Survey Taken'`;

    const rows = await this.repo.manager.query<Array<Record<string, string>>>(
      `SELECT
        SUM(CAST(ISNULL(s.initial_interest_styling, 0) AS INT)) AS styling,
        SUM(CAST(ISNULL(s.initial_interest_brand, 0) AS INT)) AS brand_reputation,
        SUM(CAST(ISNULL(s.initial_interest_features, 0) AS INT)) AS features,
        SUM(CAST(ISNULL(s.initial_interest_size, 0) AS INT)) AS size_practicality,
        SUM(CAST(ISNULL(s.initial_interest_performance, 0) AS INT)) AS performance,
        SUM(CAST(ISNULL(s.initial_interest_price, 0) AS INT)) AS price_value,
        COUNT(1) AS surveyed
      FROM app.survey_responses s ${baseFilter}`,
      params,
    );

    const r = rows[0] ?? {};
    const surveyed = parseInt(r.surveyed ?? '0', 10);

    return {
      surveyed,
      factors: [
        { factor: 'Styling / Design', count: parseInt(r.styling ?? '0', 10) },
        { factor: 'Brand Reputation', count: parseInt(r.brand_reputation ?? '0', 10) },
        { factor: 'Features', count: parseInt(r.features ?? '0', 10) },
        { factor: 'Size / Practicality', count: parseInt(r.size_practicality ?? '0', 10) },
        { factor: 'Performance', count: parseInt(r.performance ?? '0', 10) },
        { factor: 'Price / Value', count: parseInt(r.price_value ?? '0', 10) },
      ].sort((a, b) => b.count - a.count),
    };
  }

  // ── Not-purchase reasons ──────────────────────────────────────────────────

  async getNotPurchaseReasons(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const baseFilter = clause
      ? clause + ` AND s.survey_flow_status = 'Survey Taken'`
      : `WHERE s.survey_flow_status = 'Survey Taken'`;

    const rows = await this.repo.manager.query<Array<Record<string, string>>>(
      `SELECT
        SUM(CAST(ISNULL(s.not_purchased_price, 0) AS INT)) AS price,
        SUM(CAST(ISNULL(s.not_purchased_expectations, 0) AS INT)) AS expectations,
        SUM(CAST(ISNULL(s.not_purchased_different_brand, 0) AS INT)) AS different_brand,
        SUM(CAST(ISNULL(s.not_purchased_different_model, 0) AS INT)) AS different_model,
        SUM(CAST(ISNULL(s.not_purchased_financing, 0) AS INT)) AS financing,
        SUM(CAST(ISNULL(s.not_purchased_dealership, 0) AS INT)) AS dealership_experience,
        COUNT(1) AS surveyed
      FROM app.survey_responses s ${baseFilter}`,
      params,
    );

    const r = rows[0] ?? {};
    const surveyed = parseInt(r.surveyed ?? '0', 10);

    return {
      surveyed,
      reasons: [
        { reason: 'Price', count: parseInt(r.price ?? '0', 10) },
        { reason: 'Expectations Not Met', count: parseInt(r.expectations ?? '0', 10) },
        { reason: 'Purchased Different Brand', count: parseInt(r.different_brand ?? '0', 10) },
        { reason: 'Purchased Different Model', count: parseInt(r.different_model ?? '0', 10) },
        { reason: 'Financing', count: parseInt(r.financing ?? '0', 10) },
        { reason: 'Dealership Experience', count: parseInt(r.dealership_experience ?? '0', 10) },
      ].sort((a, b) => b.count - a.count),
    };
  }

  // ── Competitor purchases ──────────────────────────────────────────────────

  async getCompetitorPurchases(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const baseFilter = clause
      ? clause + ` AND s.purchased_make IS NOT NULL AND s.purchased_make != ''`
      : `WHERE s.purchased_make IS NOT NULL AND s.purchased_make != ''`;

    const rows = await this.repo.manager.query<Array<{ make: string; count: string }>>(
      `SELECT s.purchased_make AS make, COUNT(1) AS count
       FROM app.survey_responses s ${baseFilter}
       GROUP BY s.purchased_make
       ORDER BY COUNT(1) DESC`,
      params,
    );

    return rows.map((r) => ({
      make: r.make,
      count: parseInt(r.count, 10),
    }));
  }

  // ── Competitor model detail (drill into a specific make) ──────────────────

  async getCompetitorModels(f: SurveyFilter, make: string) {
    const { clause, params } = this.buildWhere(f);
    const idx = params.length;

    const baseFilter = clause
      ? clause + ` AND s.purchased_make = @${idx}`
      : `WHERE s.purchased_make = @${idx}`;

    const rows = await this.repo.manager.query<Array<{ model: string; count: string }>>(
      `SELECT COALESCE(NULLIF(s.purchased_model, ''), s.purchased_other_model, 'Unknown') AS model, COUNT(1) AS count
       FROM app.survey_responses s ${baseFilter}
       GROUP BY COALESCE(NULLIF(s.purchased_model, ''), s.purchased_other_model, 'Unknown')
       ORDER BY COUNT(1) DESC`,
      [...params, make],
    );

    return rows.map((r) => ({
      model: r.model,
      count: parseInt(r.count, 10),
    }));
  }

  // ── Dealership ratings ────────────────────────────────────────────────────

  async getDealershipRatings(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const baseFilter = clause
      ? clause + ` AND s.dealership_rating IS NOT NULL`
      : `WHERE s.dealership_rating IS NOT NULL`;

    // Distribution
    const dist = await this.repo.manager.query<Array<{ rating: string; count: string }>>(
      `SELECT s.dealership_rating AS rating, COUNT(1) AS count
       FROM app.survey_responses s ${baseFilter}
       GROUP BY s.dealership_rating
       ORDER BY s.dealership_rating`,
      params,
    );

    // By dealer (top 20)
    const byDealer = await this.repo.manager.query<Array<{ dealer: string; avg_rating: string; count: string }>>(
      `SELECT s.dealer, AVG(CAST(s.dealership_rating AS FLOAT)) AS avg_rating, COUNT(1) AS count
       FROM app.survey_responses s ${baseFilter} AND s.dealer IS NOT NULL
       GROUP BY s.dealer
       HAVING COUNT(1) >= 2
       ORDER BY AVG(CAST(s.dealership_rating AS FLOAT)) DESC`,
      params,
    );

    return {
      distribution: dist.map((r) => ({
        rating: parseInt(r.rating, 10),
        count: parseInt(r.count, 10),
      })),
      by_dealer: byDealer.slice(0, 20).map((r) => ({
        dealer: r.dealer,
        avg_rating: parseFloat(parseFloat(r.avg_rating).toFixed(1)),
        count: parseInt(r.count, 10),
      })),
    };
  }

  // ── Dealer visit outcomes ─────────────────────────────────────────────────

  async getDealerVisitOutcomes(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const baseFilter = clause
      ? clause + ` AND s.dealer_visit IS NOT NULL AND s.dealer_visit != ''`
      : `WHERE s.dealer_visit IS NOT NULL AND s.dealer_visit != ''`;

    const rows = await this.repo.manager.query<Array<{ visit_type: string; count: string }>>(
      `SELECT s.dealer_visit AS visit_type, COUNT(1) AS count
       FROM app.survey_responses s ${baseFilter}
       GROUP BY s.dealer_visit
       ORDER BY COUNT(1) DESC`,
      params,
    );

    return rows.map((r) => ({
      visit_type: r.visit_type,
      count: parseInt(r.count, 10),
    }));
  }

  // ── Model performance (enquired model breakdown) ──────────────────────────

  async getModelPerformance(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const baseFilter = clause
      ? clause + ` AND s.model IS NOT NULL`
      : `WHERE s.model IS NOT NULL`;

    const rows = await this.repo.manager.query<Array<{
      model: string; total: string; still_considering: string;
      purchased_elsewhere: string; survey_taken: string;
    }>>(
      `SELECT
        s.model,
        COUNT(1) AS total,
        SUM(CASE WHEN s.p2_still_considering = 'Yes' THEN 1 ELSE 0 END) AS still_considering,
        SUM(CASE WHEN s.purchased_make IS NOT NULL AND s.purchased_make != '' THEN 1 ELSE 0 END) AS purchased_elsewhere,
        SUM(CASE WHEN s.survey_flow_status = 'Survey Taken' THEN 1 ELSE 0 END) AS survey_taken
      FROM app.survey_responses s ${baseFilter}
      GROUP BY s.model
      HAVING COUNT(1) >= 2
      ORDER BY COUNT(1) DESC`,
      params,
    );

    return rows.map((r) => ({
      model: r.model,
      total: parseInt(r.total, 10),
      still_considering: parseInt(r.still_considering, 10),
      purchased_elsewhere: parseInt(r.purchased_elsewhere, 10),
      survey_taken: parseInt(r.survey_taken, 10),
    }));
  }

  // ── Individual records by category ────────────────────────────────────────

  async getRecordsByCategory(f: SurveyFilter, category: string, limit = 200, offset = 0) {
    const { clause, params } = this.buildWhere(f);
    const idx = params.length;

    const catCondition = category === 'Unknown'
      ? `(s.result_code_desc IS NULL OR s.result_code_desc = '')`
      : `s.result_code_desc = @${idx}`;

    const catParams = category === 'Unknown' ? [] : [category];

    const rows = await this.repo.manager.query(
      `SELECT s.id_opportunity, s.manufacture, s.model, s.dealer,
              s.result_code_desc, s.category, s.allocation_date,
              s.survey_flow_status, s.agent_notes, s.purchased_make,
              s.purchased_model, s.p2_has_not_purchased_yet
       FROM app.survey_responses s
       ${clause ? clause + ' AND ' + catCondition : 'WHERE ' + catCondition}
       ORDER BY s.allocation_date DESC
       OFFSET @${idx + catParams.length} ROWS FETCH NEXT @${idx + catParams.length + 1} ROWS ONLY`,
      [...params, ...catParams, offset, limit],
    );

    return rows;
  }

  // ── Individual records by competitor make ──────────────────────────────────

  async getRecordsByCompetitorMake(f: SurveyFilter, make: string, limit = 200, offset = 0) {
    const { clause, params } = this.buildWhere(f);
    const idx = params.length;

    const rows = await this.repo.manager.query(
      `SELECT s.id_opportunity, s.manufacture, s.model, s.dealer,
              s.result_code_desc, s.category, s.allocation_date,
              s.purchased_make, s.purchased_model, s.purchased_other_model,
              s.purchased_new_used, s.purchase_reason, s.purchase_influence,
              s.agent_notes, s.survey_flow_status
       FROM app.survey_responses s
       ${clause ? clause + ` AND s.purchased_make = @${idx}` : `WHERE s.purchased_make = @${idx}`}
       ORDER BY s.allocation_date DESC
       OFFSET @${idx + 1} ROWS FETCH NEXT @${idx + 2} ROWS ONLY`,
      [...params, make, offset, limit],
    );

    return rows;
  }

  // ── Single record detail ──────────────────────────────────────────────────

  async getRecordDetail(id: number) {
    return this.repo.findOne({ where: { id_opportunity: id } });
  }
}
