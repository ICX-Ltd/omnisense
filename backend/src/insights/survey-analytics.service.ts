import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { isChineseOem } from './nmgb-competitors';

export type SurveyFilter = {
  from?: Date;
  to?: Date;
  campaign?: string;
  manufacture?: string;
  model?: string;
  dealer?: string;
  surveyTakenOnly?: boolean;
};

// ── campaign_answers_json access helpers ─────────────────────────────────────
// Survey answers live in app.interaction_insights.campaign_answers_json (written
// per interaction — see sql/nmgb_survey_insights.sql), joined to app.interactions
// for context (make/model/dealer/date/outcome). The old app.survey_responses
// table is decommissioned. Everything is scoped to conversation_type='survey' so
// it never mixes in Parity or other campaigns that share this column.
const FROM_SURVEY =
  `FROM app.interaction_insights ii INNER JOIN app.interactions ia ON ia.id = ii.recordingId`;
const EFF_DATE = 'COALESCE(ia.interactionDateTime, ia.createdAt)';

// JSON scalar accessor.
const CA = (p: string) => `JSON_VALUE(ii.campaign_answers_json, '${p}')`;
// A survey boolean flag may serialise as true / 1 / "Yes" depending on the source
// column type — treat all as set.
const TRUTHY = `('true', '1', 'Yes', 'Y')`;
const flagSum = (p: string, alias: string) =>
  `SUM(CASE WHEN ${CA(p)} IN ${TRUTHY} THEN 1 ELSE 0 END) AS ${alias}`;
const isSet = (p: string) => `${CA(p)} IS NOT NULL AND ${CA(p)} <> ''`;

// ── Defection vs retention ───────────────────────────────────────────────────
// P4 Q5 (competitor_purchase.make) is populated even when the customer bought
// the CLIENT'S OWN brand — that's a retained sale, not a loss. A defection means
// they bought a make DIFFERENT from the one they enquired about (ia.vehicleMake);
// buying the enquired brand is "won". We deliberately do NOT gate on the
// "purchased make of interest" flag — in this data it is set broadly and would
// wrongly exclude genuine competitor purchases.
const OWN_BRAND_MATCH = `UPPER(LTRIM(RTRIM(${CA('$.competitor_purchase.make')}))) = UPPER(LTRIM(RTRIM(COALESCE(ia.vehicleMake, ''))))`;
const DEFECTED = `(${isSet('$.competitor_purchase.make')} AND NOT (${OWN_BRAND_MATCH}))`;
const WON = `(${isSet('$.competitor_purchase.make')} AND ${OWN_BRAND_MATCH})`;

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return ['true', '1', 'yes', 'y'].includes(v.toLowerCase());
  return false;
}

// Human labels for the 18 P4 Q6 purchase-influence factors.
const INFLUENCE_LABELS: Record<string, string> = {
  apr_lower: 'Lower APR', better_value: 'Better value', brand_loyalty: 'Brand loyalty',
  colour_spec_pref: 'Colour / spec preference', comfortable_interior: 'Comfortable interior',
  customer_service: 'Customer service', discount: 'Discount', drive_of_vehicle: 'Drive of vehicle',
  enhanced_features: 'Enhanced features', longer_warranty: 'Longer warranty',
  monthly_payments_lower: 'Lower monthly payments', powertrain_options: 'Powertrain options',
  pref_design: 'Preferred design', quicker_delivery: 'Quicker delivery', size: 'Size',
  try_different: 'Wanted to try different', purchased_moi_on_record: 'Purchased make of interest',
  other: 'Other',
};

@Injectable()
export class SurveyAnalyticsService {
  constructor(
    // Repo is only used for its `.manager.query` (raw SQL) — no survey_responses entity access.
    @InjectRepository(InteractionInsight)
    private repo: Repository<InteractionInsight>,
  ) {}

  private buildWhere(f: SurveyFilter): { clause: string; params: any[] } {
    const parts: string[] = [
      `ii.campaign_answers_json IS NOT NULL`,
      `ii.conversation_type = 'survey'`,
    ];
    const params: any[] = [];

    if (f.from) { parts.push(`${EFF_DATE} >= @${params.length}`); params.push(f.from); }
    if (f.to) { parts.push(`${EFF_DATE} < @${params.length}`); params.push(f.to); }
    if (f.campaign) { parts.push(`ia.campaign = @${params.length}`); params.push(f.campaign); }
    if (f.manufacture) { parts.push(`ia.vehicleMake = @${params.length}`); params.push(f.manufacture); }
    if (f.model) { parts.push(`ia.vehicleModel = @${params.length}`); params.push(f.model); }
    if (f.dealer) { parts.push(`ia.dealer = @${params.length}`); params.push(f.dealer); }
    if (f.surveyTakenOnly) parts.push(`${CA('$.meta.flow_status')} = 'Survey Taken'`);

    return { clause: 'WHERE ' + parts.join(' AND '), params };
  }

  // ── Filter options ────────────────────────────────────────────────────────

  async getFilterOptions() {
    const distinct = async (col: string) =>
      (await this.repo.manager.query<Array<{ v: string }>>(
        `SELECT DISTINCT ${col} AS v ${FROM_SURVEY}
         WHERE ii.conversation_type = 'survey' AND ii.campaign_answers_json IS NOT NULL
           AND ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`,
      )).map((r) => r.v);

    return {
      campaigns: await distinct('ia.campaign'),
      manufactures: await distinct('ia.vehicleMake'),
      models: await distinct('ia.vehicleModel'),
      dealers: await distinct('ia.dealer'),
    };
  }

  // ── Overview metrics ──────────────────────────────────────────────────────

  async getOverview(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const totals = await this.repo.manager.query<Array<{
      total: string; survey_taken: string; survey_not_taken: string;
      defected: string; won: string; still_considering: string;
    }>>(
      `SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN ${CA('$.meta.flow_status')} = 'Survey Taken' THEN 1 ELSE 0 END) AS survey_taken,
        SUM(CASE WHEN ${CA('$.meta.flow_status')} = 'Survey Not Taken' THEN 1 ELSE 0 END) AS survey_not_taken,
        SUM(CASE WHEN ${DEFECTED} THEN 1 ELSE 0 END) AS defected,
        SUM(CASE WHEN ${WON} THEN 1 ELSE 0 END) AS won,
        ${flagSum('$.purchase_status.still_considering', 'still_considering')}
      ${FROM_SURVEY} ${clause}`,
      params,
    );

    const t = totals[0];
    return {
      total: parseInt(t?.total ?? '0', 10),
      survey_taken: parseInt(t?.survey_taken ?? '0', 10),
      survey_not_taken: parseInt(t?.survey_not_taken ?? '0', 10),
      defected: parseInt(t?.defected ?? '0', 10),
      won: parseInt(t?.won ?? '0', 10),
      still_considering: parseInt(t?.still_considering ?? '0', 10),
    };
  }

  // ── Category breakdown (interaction outcome / result code) ────────────────

  async getCategoryBreakdown(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const rows = await this.repo.manager.query<Array<{ category: string; count: string }>>(
      `SELECT COALESCE(ia.outcome, 'Unknown') AS category, COUNT(1) AS count
       ${FROM_SURVEY} ${clause}
       GROUP BY ia.outcome
       ORDER BY COUNT(1) DESC`,
      params,
    );

    return rows.map((r) => ({ category: r.category, count: parseInt(r.count, 10) }));
  }

  // ── Initial interest factors ──────────────────────────────────────────────

  async getInterestFactors(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const baseFilter = clause + ` AND ${CA('$.meta.flow_status')} = 'Survey Taken'`;

    const rows = await this.repo.manager.query<Array<Record<string, string>>>(
      `SELECT
        ${flagSum('$.initial_interest.styling_design', 'styling')},
        ${flagSum('$.initial_interest.brand_reputation', 'brand_reputation')},
        ${flagSum('$.initial_interest.features', 'features')},
        ${flagSum('$.initial_interest.size_practicality', 'size_practicality')},
        ${flagSum('$.initial_interest.performance', 'performance')},
        ${flagSum('$.initial_interest.price_value', 'price_value')},
        COUNT(1) AS surveyed
      ${FROM_SURVEY} ${baseFilter}`,
      params,
    );

    const r = rows[0] ?? {};
    return {
      surveyed: parseInt(r.surveyed ?? '0', 10),
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
    const baseFilter = clause + ` AND ${CA('$.meta.flow_status')} = 'Survey Taken'`;

    const rows = await this.repo.manager.query<Array<Record<string, string>>>(
      `SELECT
        ${flagSum('$.not_purchased_reasons.price', 'price')},
        ${flagSum('$.not_purchased_reasons.expectations', 'expectations')},
        ${flagSum('$.not_purchased_reasons.different_brand', 'different_brand')},
        ${flagSum('$.not_purchased_reasons.different_client_model', 'different_model')},
        ${flagSum('$.not_purchased_reasons.financing', 'financing')},
        ${flagSum('$.not_purchased_reasons.dealership_experience', 'dealership_experience')},
        COUNT(1) AS surveyed
      ${FROM_SURVEY} ${baseFilter}`,
      params,
    );

    const r = rows[0] ?? {};
    return {
      surveyed: parseInt(r.surveyed ?? '0', 10),
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

    const rows = await this.repo.manager.query<Array<{ make: string; count: string }>>(
      `SELECT ${CA('$.competitor_purchase.make')} AS make, COUNT(1) AS count
       ${FROM_SURVEY} ${clause} AND ${DEFECTED}
       GROUP BY ${CA('$.competitor_purchase.make')}
       ORDER BY COUNT(1) DESC`,
      params,
    );

    return rows.map((r) => ({ make: r.make, count: parseInt(r.count, 10) }));
  }

  // ── Competitor model detail (drill into a specific make) ──────────────────

  async getCompetitorModels(f: SurveyFilter, make: string) {
    const { clause, params } = this.buildWhere(f);
    const idx = params.length;
    const modelExpr = `COALESCE(NULLIF(${CA('$.competitor_purchase.model')}, ''), ${CA('$.competitor_purchase.other_model_not_listed')}, 'Unknown')`;

    const rows = await this.repo.manager.query<Array<{ model: string; count: string }>>(
      `SELECT ${modelExpr} AS model, COUNT(1) AS count
       ${FROM_SURVEY} ${clause} AND ${CA('$.competitor_purchase.make')} = @${idx}
       GROUP BY ${modelExpr}
       ORDER BY COUNT(1) DESC`,
      [...params, make],
    );

    return rows.map((r) => ({ model: r.model, count: parseInt(r.count, 10) }));
  }

  // ── Dealership ratings ────────────────────────────────────────────────────

  async getDealershipRatings(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const ratingInt = `TRY_CAST(${CA('$.dealership_rating.score')} AS INT)`;
    const ratingFloat = `TRY_CAST(${CA('$.dealership_rating.score')} AS FLOAT)`;
    const baseFilter = clause + ` AND ${ratingInt} IS NOT NULL`;

    const dist = await this.repo.manager.query<Array<{ rating: string; count: string }>>(
      `SELECT ${ratingInt} AS rating, COUNT(1) AS count
       ${FROM_SURVEY} ${baseFilter}
       GROUP BY ${ratingInt}
       ORDER BY ${ratingInt}`,
      params,
    );

    const byDealer = await this.repo.manager.query<Array<{ dealer: string; avg_rating: string; count: string }>>(
      `SELECT ia.dealer, AVG(${ratingFloat}) AS avg_rating, COUNT(1) AS count
       ${FROM_SURVEY} ${baseFilter} AND ia.dealer IS NOT NULL
       GROUP BY ia.dealer
       HAVING COUNT(1) >= 2
       ORDER BY AVG(${ratingFloat}) DESC`,
      params,
    );

    return {
      distribution: dist.map((r) => ({ rating: parseInt(r.rating, 10), count: parseInt(r.count, 10) })),
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

    const rows = await this.repo.manager.query<Array<{ visit_type: string; count: string }>>(
      `SELECT ${CA('$.dealer_visit.visited')} AS visit_type, COUNT(1) AS count
       ${FROM_SURVEY} ${clause} AND ${isSet('$.dealer_visit.visited')}
       GROUP BY ${CA('$.dealer_visit.visited')}
       ORDER BY COUNT(1) DESC`,
      params,
    );

    return rows.map((r) => ({ visit_type: r.visit_type, count: parseInt(r.count, 10) }));
  }

  // ── Model performance (enquired model breakdown) ──────────────────────────

  async getModelPerformance(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const baseFilter = clause + ` AND ia.vehicleModel IS NOT NULL AND ia.vehicleModel <> ''`;

    const rows = await this.repo.manager.query<Array<{
      model: string; total: string; still_considering: string;
      purchased_elsewhere: string; survey_taken: string;
    }>>(
      `SELECT
        ia.vehicleModel AS model,
        COUNT(1) AS total,
        ${flagSum('$.purchase_status.still_considering', 'still_considering')},
        SUM(CASE WHEN ${DEFECTED} THEN 1 ELSE 0 END) AS purchased_elsewhere,
        SUM(CASE WHEN ${CA('$.meta.flow_status')} = 'Survey Taken' THEN 1 ELSE 0 END) AS survey_taken
      ${FROM_SURVEY} ${baseFilter}
      GROUP BY ia.vehicleModel
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

  // ── Individual records by category (interaction outcome) ──────────────────

  private recordSelect() {
    return `CAST(ia.id AS VARCHAR(36)) AS interaction_id,
      TRY_CAST(${CA('$.meta.id_opportunity')} AS INT) AS id_opportunity,
      ia.vehicleMake AS manufacture, ia.vehicleModel AS model, ia.dealer AS dealer,
      ia.outcome AS result_code_desc, ia.outcome AS category, ${EFF_DATE} AS allocation_date,
      ${CA('$.meta.flow_status')} AS survey_flow_status,
      ${CA('$.agent_notes')} AS agent_notes,
      ${CA('$.competitor_purchase.make')} AS purchased_make,
      ${CA('$.competitor_purchase.model')} AS purchased_model,
      ${CA('$.competitor_purchase.other_model_not_listed')} AS purchased_other_model,
      ${CA('$.competitor_purchase.new_used')} AS purchased_new_used,
      ${CA('$.purchase_reason')} AS purchase_reason,
      ${CA('$.purchase_status.has_not_purchased_yet')} AS p2_has_not_purchased_yet`;
  }

  async getRecordsByCategory(f: SurveyFilter, category: string, limit = 200, offset = 0) {
    const { clause, params } = this.buildWhere(f);
    const idx = params.length;

    const catCondition = category === 'Unknown'
      ? `(ia.outcome IS NULL OR ia.outcome = '')`
      : `ia.outcome = @${idx}`;
    const catParams = category === 'Unknown' ? [] : [category];

    return this.repo.manager.query(
      `SELECT ${this.recordSelect()}
       ${FROM_SURVEY} ${clause} AND ${catCondition}
       ORDER BY ${EFF_DATE} DESC
       OFFSET @${idx + catParams.length} ROWS FETCH NEXT @${idx + catParams.length + 1} ROWS ONLY`,
      [...params, ...catParams, offset, limit],
    );
  }

  // ── Individual records by competitor make ──────────────────────────────────

  async getRecordsByCompetitorMake(f: SurveyFilter, make: string, limit = 200, offset = 0) {
    const { clause, params } = this.buildWhere(f);
    const idx = params.length;

    return this.repo.manager.query(
      `SELECT ${this.recordSelect()}
       ${FROM_SURVEY} ${clause} AND ${CA('$.competitor_purchase.make')} = @${idx}
       ORDER BY ${EFF_DATE} DESC
       OFFSET @${idx + 1} ROWS FETCH NEXT @${idx + 2} ROWS ONLY`,
      [...params, make, offset, limit],
    );
  }

  // ── Flexible drill: records matching a panel selection ─────────────────────
  // Backs the drill-downs on the competitive panels (e.g. "customers lost to a
  // Chinese OEM on price"). Returns the same row shape as the other record lists
  // so the existing detail drawer works unchanged.
  private static readonly REASON_PATHS: Record<string, string> = {
    price: '$.not_purchased_reasons.price',
    expectations: '$.not_purchased_reasons.expectations',
    different_brand: '$.not_purchased_reasons.different_brand',
    different_model: '$.not_purchased_reasons.different_client_model',
    financing: '$.not_purchased_reasons.financing',
    dealership_experience: '$.not_purchased_reasons.dealership_experience',
  };

  async getDrillRecords(
    f: SurveyFilter,
    criteria: {
      competitorMake?: string; chineseOnly?: boolean; excludeChinese?: boolean;
      notPurchaseReason?: string; model?: string; defectedOnly?: boolean; wonOnly?: boolean;
    },
    limit = 200,
    offset = 0,
  ) {
    const { clause, params } = this.buildWhere(f);
    const conds: string[] = [];
    const extra: any[] = [];
    const pushParam = (v: any) => { extra.push(v); return `@${params.length + extra.length - 1}`; };

    if (criteria.defectedOnly) conds.push(DEFECTED);
    if (criteria.wonOnly) conds.push(WON);
    if (criteria.model) conds.push(`ia.vehicleModel = ${pushParam(criteria.model)}`);
    if (criteria.competitorMake) conds.push(`${CA('$.competitor_purchase.make')} = ${pushParam(criteria.competitorMake)}`);
    if (criteria.notPurchaseReason) {
      const path = SurveyAnalyticsService.REASON_PATHS[criteria.notPurchaseReason];
      if (path) conds.push(`${CA(path)} IN ${TRUTHY}`);
    }
    if (criteria.chineseOnly || criteria.excludeChinese) {
      // Chinese makes present in the defection cohort (classified in JS).
      const makeRows = await this.repo.manager.query<Array<{ make: string }>>(
        `SELECT DISTINCT ${CA('$.competitor_purchase.make')} AS make ${FROM_SURVEY} ${clause} AND ${DEFECTED}`,
        params,
      );
      const chineseMakes = makeRows.map((r) => r.make).filter((m) => isChineseOem(m));
      if (criteria.chineseOnly) {
        if (chineseMakes.length) {
          const ph = chineseMakes.map((m) => pushParam(m));
          conds.push(`${CA('$.competitor_purchase.make')} IN (${ph.join(', ')})`);
        } else {
          conds.push('1 = 0');
        }
      } else if (chineseMakes.length) {
        // excludeChinese: only meaningful when Chinese makes exist to exclude.
        const ph = chineseMakes.map((m) => pushParam(m));
        conds.push(`${CA('$.competitor_purchase.make')} NOT IN (${ph.join(', ')})`);
      }
    }

    const whereFull = clause + (conds.length ? ' AND ' + conds.join(' AND ') : '');
    const offIdx = params.length + extra.length;

    return this.repo.manager.query(
      `SELECT ${this.recordSelect()}
       ${FROM_SURVEY} ${whereFull}
       ORDER BY ${EFF_DATE} DESC
       OFFSET @${offIdx} ROWS FETCH NEXT @${offIdx + 1} ROWS ONLY`,
      [...params, ...extra, offset, limit],
    );
  }

  // ── Single record detail (projected from campaign_answers_json) ───────────

  async getRecordDetail(id: string) {
    const rows = await this.repo.manager.query<Array<{
      caj: string; manufacture: string | null; model: string | null; dealer: string | null;
      campaign: string | null; outcome: string | null; recordingUrl: string | null; allocation_date: Date | null;
    }>>(
      `SELECT TOP 1
        ii.campaign_answers_json AS caj,
        ia.vehicleMake AS manufacture, ia.vehicleModel AS model, ia.dealer AS dealer,
        ia.campaign AS campaign, ia.outcome AS outcome, ia.recordingUrl AS recordingUrl,
        ${EFF_DATE} AS allocation_date
      ${FROM_SURVEY}
      WHERE ii.conversation_type = 'survey' AND ii.campaign_answers_json IS NOT NULL
        AND ia.id = @0`,
      [id],
    );

    const row = rows[0];
    if (!row) return null;

    let a: any = {};
    try { a = JSON.parse(row.caj) ?? {}; } catch { a = {}; }
    const ii = a.initial_interest ?? {};
    const npr = a.not_purchased_reasons ?? {};
    const cp = a.competitor_purchase ?? {};
    const dv = a.dealer_visit ?? {};
    const dr = a.dealership_rating ?? {};
    const ps = a.purchase_status ?? {};
    const inf = a.influenced_by ?? {};

    const influenceText = Object.entries(INFLUENCE_LABELS)
      .filter(([k]) => truthy(inf[k]))
      .map(([, label]) => label)
      .join(', ') || null;

    const ratingNum = dr.score != null && dr.score !== '' ? Number(dr.score) : null;

    return {
      id_opportunity: a.meta?.id_opportunity ?? id,
      campaign: row.campaign,
      manufacture: row.manufacture,
      model: row.model,
      dealer: row.dealer,
      allocation_date: row.allocation_date,
      result_code_desc: row.outcome,
      survey_flow_status: a.meta?.flow_status ?? null,
      source_type: null,
      fpi_date: null,
      p2_has_not_purchased_yet: ps.has_not_purchased_yet ?? null,
      p2_still_considering: ps.still_considering ?? null,
      p3_interest_follow_up: a.follow_up_interest ?? null,
      initial_interest_styling: truthy(ii.styling_design),
      initial_interest_brand: truthy(ii.brand_reputation),
      initial_interest_features: truthy(ii.features),
      initial_interest_size: truthy(ii.size_practicality),
      initial_interest_performance: truthy(ii.performance),
      initial_interest_price: truthy(ii.price_value),
      initial_interest_other: ii.other_feedback ?? null,
      dealer_visit: dv.visited ?? null,
      dealership_rating: Number.isFinite(ratingNum as number) ? ratingNum : null,
      vehicle_impression: dv.vehicle_impression ?? null,
      why_no_test_drive: dv.why_no_test_drive ?? null,
      dealership_rating_feedback: dr.feedback ?? null,
      not_purchased_price: truthy(npr.price),
      not_purchased_expectations: truthy(npr.expectations),
      not_purchased_different_brand: truthy(npr.different_brand),
      not_purchased_different_model: truthy(npr.different_client_model),
      not_purchased_financing: truthy(npr.financing),
      not_purchased_dealership: truthy(npr.dealership_experience),
      not_purchased_other: npr.other_feedback ?? null,
      not_purchased_price_feedback: npr.price_sub_reason ?? null,
      purchased_make: cp.make ?? null,
      purchased_model: cp.model ?? null,
      purchased_other_model: cp.other_model_not_listed ?? null,
      purchased_new_used: cp.new_used ?? null,
      purchase_influence: influenceText,
      purchase_reason: a.purchase_reason ?? null,
      improve_anything: a.improvements?.anything_different ?? null,
      improve_follow_up: a.improvements?.follow_up ?? null,
      agent_notes: a.agent_notes ?? null,
      call_recording_url: row.recordingUrl,
      // Full parsed survey answers, so the drawer can render every stored field
      // regardless of the projected shape above.
      answers: a,
    };
  }

  // ── Competitor analysis + Chinese-OEM grouping (Prompts 1 & 2) ─────────────
  // The "defection cohort" = survey rows where the customer bought another
  // vehicle (competitor_purchase.make set). Each make is tagged Chinese / other.
  async getCompetitorAnalysis(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const rows = await this.repo.manager.query<Array<{ make: string; count: string }>>(
      `SELECT ${CA('$.competitor_purchase.make')} AS make, COUNT(1) AS count
       ${FROM_SURVEY} ${clause} AND ${DEFECTED}
       GROUP BY ${CA('$.competitor_purchase.make')}
       ORDER BY COUNT(1) DESC`,
      params,
    );

    const brands = rows.map((r) => ({
      make: r.make,
      count: parseInt(r.count, 10),
      chinese: isChineseOem(r.make),
    }));
    const totalDefections = brands.reduce((a, b) => a + b.count, 0);
    const chineseDefections = brands.filter((b) => b.chinese).reduce((a, b) => a + b.count, 0);

    return {
      total_defections: totalDefections,
      chinese_defections: chineseDefections,
      chinese_share: totalDefections ? Math.round((chineseDefections / totalDefections) * 100) : 0,
      brands,
      chinese_brands: brands.filter((b) => b.chinese),
    };
  }

  // ── Quarter-on-quarter trend (Prompt 3) ────────────────────────────────────
  async getQuarterlyTrends(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const totals = await this.repo.manager.query<Array<{
      yr: string; qtr: string; total: string; defections: string;
    }>>(
      `SELECT YEAR(${EFF_DATE}) AS yr, DATEPART(QUARTER, ${EFF_DATE}) AS qtr,
              COUNT(1) AS total,
              SUM(CASE WHEN ${DEFECTED} THEN 1 ELSE 0 END) AS defections
       ${FROM_SURVEY} ${clause}
       GROUP BY YEAR(${EFF_DATE}), DATEPART(QUARTER, ${EFF_DATE})
       ORDER BY YEAR(${EFF_DATE}), DATEPART(QUARTER, ${EFF_DATE})`,
      params,
    );

    const makeRows = await this.repo.manager.query<Array<{
      yr: string; qtr: string; make: string; count: string;
    }>>(
      `SELECT YEAR(${EFF_DATE}) AS yr, DATEPART(QUARTER, ${EFF_DATE}) AS qtr,
              ${CA('$.competitor_purchase.make')} AS make, COUNT(1) AS count
       ${FROM_SURVEY} ${clause} AND ${DEFECTED}
       GROUP BY YEAR(${EFF_DATE}), DATEPART(QUARTER, ${EFF_DATE}), ${CA('$.competitor_purchase.make')}`,
      params,
    );

    // Per quarter: Chinese defection count, top overall competitor and top
    // Chinese competitor (each with its make + count).
    const byQuarter = new Map<string, {
      chinese: number;
      top?: { make: string; count: number };
      topChinese?: { make: string; count: number };
    }>();
    for (const r of makeRows) {
      const key = `${r.yr}-${r.qtr}`;
      const count = parseInt(r.count, 10);
      const agg = byQuarter.get(key) ?? { chinese: 0 };
      if (!agg.top || count > agg.top.count) agg.top = { make: r.make, count };
      if (isChineseOem(r.make)) {
        agg.chinese += count;
        if (!agg.topChinese || count > agg.topChinese.count) agg.topChinese = { make: r.make, count };
      }
      byQuarter.set(key, agg);
    }

    const share = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

    return totals.map((r) => {
      const agg = byQuarter.get(`${r.yr}-${r.qtr}`) ?? { chinese: 0 };
      const defections = parseInt(r.defections, 10);
      return {
        quarter: `${r.yr} Q${r.qtr}`,
        total: parseInt(r.total, 10),
        defections,
        chinese_defections: agg.chinese,
        chinese_share: share(agg.chinese, defections),
        top_competitor: agg.top?.make ?? null,
        top_competitor_count: agg.top?.count ?? 0,
        top_competitor_share: share(agg.top?.count ?? 0, defections),
        top_chinese_competitor: agg.topChinese?.make ?? null,
        top_chinese_competitor_count: agg.topChinese?.count ?? 0,
        top_chinese_competitor_share: share(agg.topChinese?.count ?? 0, defections),
      };
    });
  }

  // ── Monthly brand trend lines (over the selected period) ───────────────────
  // Per-month defection counts for each Chinese OEM (one line each) plus overall
  // totals, so the UI can plot peaks/troughs per brand across the period.
  async getMonthlyTrends(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);

    const rows = await this.repo.manager.query<Array<{
      yr: string; mo: string; make: string; count: string;
    }>>(
      `SELECT YEAR(${EFF_DATE}) AS yr, MONTH(${EFF_DATE}) AS mo,
              ${CA('$.competitor_purchase.make')} AS make, COUNT(1) AS count
       ${FROM_SURVEY} ${clause} AND ${DEFECTED}
       GROUP BY YEAR(${EFF_DATE}), MONTH(${EFF_DATE}), ${CA('$.competitor_purchase.make')}`,
      params,
    );

    const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

    // Month axis: the selected period when supplied, else the data's own range.
    let months: string[] = [];
    const pushRange = (sy: number, sm: number, ey: number, em: number) => {
      let y = sy, m = sm, guard = 0;
      while ((y < ey || (y === ey && m <= em)) && guard < 120) {
        months.push(monthKey(y, m));
        m++; if (m > 12) { m = 1; y++; }
        guard++;
      }
    };
    if (f.from && f.to) {
      const end = new Date(f.to.getTime() - 1); // to is exclusive end-of-day
      pushRange(f.from.getFullYear(), f.from.getMonth() + 1, end.getFullYear(), end.getMonth() + 1);
    } else if (rows.length) {
      const keys = [...new Set(rows.map((r) => monthKey(+r.yr, +r.mo)))].sort();
      const [ay, am] = keys[0].split('-').map(Number);
      const [by, bm] = keys[keys.length - 1].split('-').map(Number);
      pushRange(ay, am, by, bm);
    }
    if (months.length > 60) months = months.slice(months.length - 60);

    const byMonthMake = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const k = monthKey(+r.yr, +r.mo);
      const m = byMonthMake.get(k) ?? new Map<string, number>();
      m.set(r.make, (m.get(r.make) ?? 0) + parseInt(r.count, 10));
      byMonthMake.set(k, m);
    }

    const brandTotals = new Map<string, number>();
    for (const r of rows) {
      if (!isChineseOem(r.make)) continue;
      brandTotals.set(r.make, (brandTotals.get(r.make) ?? 0) + parseInt(r.count, 10));
    }
    const chineseBrands = [...brandTotals.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);

    const brands = chineseBrands.map((brand) => ({
      brand,
      total: brandTotals.get(brand) ?? 0,
      points: months.map((mk) => byMonthMake.get(mk)?.get(brand) ?? 0),
    }));

    const sumMonth = (mk: string, pred?: (make: string) => boolean) => {
      const m = byMonthMake.get(mk);
      if (!m) return 0;
      let s = 0;
      for (const [make, v] of m) if (!pred || pred(make)) s += v;
      return s;
    };

    return {
      months,
      brands,
      overall: {
        total_defections: months.map((mk) => sumMonth(mk)),
        chinese_defections: months.map((mk) => sumMonth(mk, isChineseOem)),
      },
    };
  }

  // ── Model risk analysis (Prompt 5) ─────────────────────────────────────────
  async getModelRisk(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const modelFilter = clause + ` AND ia.vehicleModel IS NOT NULL AND ia.vehicleModel <> ''`;

    const totals = await this.repo.manager.query<Array<{
      model: string; total: string; defections: string;
    }>>(
      `SELECT ia.vehicleModel AS model,
              COUNT(1) AS total,
              SUM(CASE WHEN ${DEFECTED} THEN 1 ELSE 0 END) AS defections
       ${FROM_SURVEY} ${modelFilter}
       GROUP BY ia.vehicleModel
       HAVING COUNT(1) >= 3`,
      params,
    );

    const modelMakeRows = await this.repo.manager.query<Array<{
      model: string; make: string; count: string;
    }>>(
      `SELECT ia.vehicleModel AS model, ${CA('$.competitor_purchase.make')} AS make, COUNT(1) AS count
       ${FROM_SURVEY} ${modelFilter} AND ${DEFECTED}
       GROUP BY ia.vehicleModel, ${CA('$.competitor_purchase.make')}`,
      params,
    );

    const modelReasonRows = await this.repo.manager.query<Array<Record<string, string>>>(
      `SELECT ia.vehicleModel AS model,
              ${flagSum('$.not_purchased_reasons.price', 'price')},
              ${flagSum('$.not_purchased_reasons.expectations', 'expectations')},
              ${flagSum('$.not_purchased_reasons.different_brand', 'different_brand')},
              ${flagSum('$.not_purchased_reasons.different_client_model', 'different_model')},
              ${flagSum('$.not_purchased_reasons.financing', 'financing')},
              ${flagSum('$.not_purchased_reasons.dealership_experience', 'dealership_experience')}
       ${FROM_SURVEY} ${modelFilter}
       GROUP BY ia.vehicleModel`,
      params,
    );

    const REASON_LABELS: Record<string, string> = {
      price: 'Price', expectations: 'Expectations', different_brand: 'Different Brand',
      different_model: 'Different Model', financing: 'Financing', dealership_experience: 'Dealership',
    };

    const makeByModel = new Map<string, { chinese: number; top?: { make: string; count: number } }>();
    for (const r of modelMakeRows) {
      const count = parseInt(r.count, 10);
      const agg = makeByModel.get(r.model) ?? { chinese: 0 };
      if (isChineseOem(r.make)) agg.chinese += count;
      if (!agg.top || count > agg.top.count) agg.top = { make: r.make, count };
      makeByModel.set(r.model, agg);
    }

    const reasonByModel = new Map<string, { reason: string; count: number } | null>();
    for (const r of modelReasonRows) {
      let top: { reason: string; count: number } | null = null;
      for (const [k, label] of Object.entries(REASON_LABELS)) {
        const c = parseInt(r[k] ?? '0', 10);
        if (c > 0 && (!top || c > top.count)) top = { reason: label, count: c };
      }
      reasonByModel.set(r.model, top);
    }

    return totals
      .map((r) => {
        const total = parseInt(r.total, 10);
        const defections = parseInt(r.defections, 10);
        const mk = makeByModel.get(r.model) ?? { chinese: 0 };
        return {
          model: r.model,
          total,
          defections,
          defection_rate: total ? Math.round((defections / total) * 100) : 0,
          top_competitor: mk.top?.make ?? null,
          chinese_defections: mk.chinese,
          chinese_share: defections ? Math.round((mk.chinese / defections) * 100) : 0,
          top_reason: reasonByModel.get(r.model)?.reason ?? null,
        };
      })
      .sort((a, b) => b.defection_rate - a.defection_rate || b.defections - a.defections);
  }

  // ── Why we lose: reasons split by Chinese vs other competitor (Prompt 4) ────
  async getWhyWeLose(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const defFilter = clause + ` AND ${DEFECTED}`;

    const makeRows = await this.repo.manager.query<Array<{ make: string }>>(
      `SELECT DISTINCT ${CA('$.competitor_purchase.make')} AS make ${FROM_SURVEY} ${defFilter}`,
      params,
    );
    const chineseMakes = makeRows.map((r) => r.make).filter((m) => isChineseOem(m));

    const extra: any[] = [];
    // With Chinese makes present we bucket via a CASE (which references a
    // column, so it can be grouped). With none, every defector is "other" — we
    // must NOT `GROUP BY 'other'` (SQL Server rejects grouping by a constant),
    // so we aggregate the whole cohort into one row instead.
    const hasChinese = chineseMakes.length > 0;
    let bucketExpr = `'other'`;
    if (hasChinese) {
      const placeholders = chineseMakes.map((m) => {
        extra.push(m);
        return `@${params.length + extra.length - 1}`;
      });
      bucketExpr = `CASE WHEN ${CA('$.competitor_purchase.make')} IN (${placeholders.join(', ')}) THEN 'chinese' ELSE 'other' END`;
    }

    const rows = await this.repo.manager.query<Array<Record<string, string>>>(
      `SELECT ${bucketExpr} AS bucket,
              ${flagSum('$.not_purchased_reasons.price', 'price')},
              ${flagSum('$.not_purchased_reasons.expectations', 'expectations')},
              ${flagSum('$.not_purchased_reasons.different_brand', 'different_brand')},
              ${flagSum('$.not_purchased_reasons.different_client_model', 'different_model')},
              ${flagSum('$.not_purchased_reasons.financing', 'financing')},
              ${flagSum('$.not_purchased_reasons.dealership_experience', 'dealership_experience')},
              COUNT(1) AS cohort
       ${FROM_SURVEY} ${defFilter}
       ${hasChinese ? `GROUP BY ${bucketExpr}` : ''}`,
      [...params, ...extra],
    );

    const REASONS: Array<[string, string]> = [
      ['price', 'Price'], ['expectations', 'Expectations'], ['different_brand', 'Different Brand'],
      ['different_model', 'Different Model'], ['financing', 'Financing'], ['dealership_experience', 'Dealership'],
    ];
    const toCohort = (row?: Record<string, string>) => ({
      cohort: parseInt(row?.cohort ?? '0', 10),
      reasons: REASONS.map(([k, label]) => ({ reason: label, key: k, count: parseInt(row?.[k] ?? '0', 10) }))
        .sort((a, b) => b.count - a.count),
    });

    const chineseRow = rows.find((r) => r.bucket === 'chinese');
    const otherRow = rows.find((r) => r.bucket === 'other');
    const overallRow: Record<string, string> = { cohort: '0' };
    for (const [k] of REASONS) overallRow[k] = '0';
    for (const row of rows) {
      overallRow.cohort = String(parseInt(overallRow.cohort, 10) + parseInt(row.cohort ?? '0', 10));
      for (const [k] of REASONS) overallRow[k] = String(parseInt(overallRow[k], 10) + parseInt(row[k] ?? '0', 10));
    }

    return {
      overall: toCohort(overallRow),
      chinese: toCohort(chineseRow),
      other: toCohort(otherRow),
    };
  }

  // ── What's working: the "won" cohort (Additional prompt) ───────────────────
  // "Won" = the customer bought the make of interest (purchased_moi_on_record),
  // recorded under either the influence or not-purchase-reason blocks.
  async getWhatWorking(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const wonFilter = clause + ` AND ${WON}`;

    const agg = await this.repo.manager.query<Array<Record<string, string>>>(
      `SELECT
        ${flagSum('$.initial_interest.styling_design', 'styling')},
        ${flagSum('$.initial_interest.brand_reputation', 'brand_reputation')},
        ${flagSum('$.initial_interest.features', 'features')},
        ${flagSum('$.initial_interest.size_practicality', 'size_practicality')},
        ${flagSum('$.initial_interest.performance', 'performance')},
        ${flagSum('$.initial_interest.price_value', 'price_value')},
        AVG(TRY_CAST(${CA('$.dealership_rating.score')} AS FLOAT)) AS avg_rating,
        COUNT(1) AS won
      ${FROM_SURVEY} ${wonFilter}`,
      params,
    );

    const byModel = await this.repo.manager.query<Array<{ model: string; count: string }>>(
      `SELECT ia.vehicleModel AS model, COUNT(1) AS count
       ${FROM_SURVEY} ${wonFilter} AND ia.vehicleModel IS NOT NULL AND ia.vehicleModel <> ''
       GROUP BY ia.vehicleModel
       ORDER BY COUNT(1) DESC`,
      params,
    );

    const r = agg[0] ?? {};
    const won = parseInt(r.won ?? '0', 10);
    const avgRating = r.avg_rating != null ? parseFloat(parseFloat(r.avg_rating).toFixed(1)) : null;

    return {
      won,
      avg_rating: Number.isNaN(avgRating as number) ? null : avgRating,
      factors: [
        { factor: 'Styling / Design', count: parseInt(r.styling ?? '0', 10) },
        { factor: 'Brand Reputation', count: parseInt(r.brand_reputation ?? '0', 10) },
        { factor: 'Features', count: parseInt(r.features ?? '0', 10) },
        { factor: 'Size / Practicality', count: parseInt(r.size_practicality ?? '0', 10) },
        { factor: 'Performance', count: parseInt(r.performance ?? '0', 10) },
        { factor: 'Price / Value', count: parseInt(r.price_value ?? '0', 10) },
      ].sort((a, b) => b.count - a.count),
      top_models: byModel.slice(0, 10).map((m) => ({ model: m.model, count: parseInt(m.count, 10) })),
    };
  }
}
