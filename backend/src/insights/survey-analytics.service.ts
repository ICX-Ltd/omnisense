import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { isChineseOem } from './nmgb-competitors';
import { createProvider } from './providers/provider.factory';
import { InsightsProviderName } from './types/insights-provider.type';
import { buildSurveyQaPrompt } from './prompt/build-survey-qa-prompt';

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
// A respondent "did not purchase" (from us) when they did NOT buy the make
// they enquired about — i.e. defectors, still-considering and no-purchase-yet,
// but excluding retained/won sales. Correct denominator for not-purchase-reason
// share: someone who bought the enquired make has no reason to give.
const NOT_PURCHASED = `NOT ${WON}`;

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

// Meta the survey projection needs beyond the parsed answers/transcript blobs.
export interface SurveyDetailMeta {
  id: string | number;
  interaction_id: string;
  interaction_tps_id: string | null;
  campaign: string | null;
  manufacture: string | null;
  model: string | null;
  dealer: string | null;
  allocation_date: Date | null;
  outcome: string | null;
  recordingUrl: string | null;
  transcript_text: string | null;
  transcript_model: string | null;
}

/**
 * Project the raw campaign_answers_json (`a`) + mined campaign_transcript_json
 * (`transcript`) into the flat, drawer-friendly survey record shape. Shared by
 * SurveyAnalyticsService.getRecordDetail AND InsightsSummaryService
 * .getInteractionDetail so both drawers render survey records identically.
 */
export function buildSurveyDetail(
  a: any,
  transcript: any,
  meta: SurveyDetailMeta,
) {
  a = a && typeof a === 'object' ? a : {};
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
    id_opportunity: a.meta?.id_opportunity ?? meta.id,
    interaction_id: meta.interaction_id,
    interaction_tps_id: meta.interaction_tps_id,
    campaign: meta.campaign,
    manufacture: meta.manufacture,
    model: meta.model,
    dealer: meta.dealer,
    allocation_date: meta.allocation_date,
    result_code_desc: meta.outcome,
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
    call_recording_url: meta.recordingUrl,
    // Full parsed survey answers, so the drawer can render every stored field
    // regardless of the projected shape above.
    answers: a,
    // Transcript-mined insights (campaign_transcript_json), null when none.
    transcript,
    // Raw verbatim transcript text (app.interaction_transcripts). Deepgram
    // calls store it diarized as "Speaker N: ..." lines; OpenAI stores prose.
    transcript_text: meta.transcript_text,
    transcript_model: meta.transcript_model,
  };
}

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

  // ── Ask AI over the filtered survey dataset ─────────────────────────────────
  // Grounded Q&A: pulls the actual rows matching the current filters and lets the
  // LLM answer/count from them (accurate, not embedding-approximate). Includes the
  // transcript per row, bounded by an overall character budget so context stays
  // safe; reports how many rows were considered vs the true total.
  async askSurvey(f: SurveyFilter, question: string, provider?: string) {
    const q = (question ?? '').trim().slice(0, 1000);
    if (!q) return { answer: 'Please enter a question.', considered: 0, total: 0, truncated: false, model: null, provider: null };

    const { clause, params } = this.buildWhere(f);

    const totalRow = await this.repo.manager.query<Array<{ n: number }>>(
      `SELECT COUNT(1) AS n ${FROM_SURVEY} ${clause}`,
      params,
    );
    const total = Number(totalRow[0]?.n ?? 0);
    if (!total) {
      return { answer: 'No survey records match the current filters.', considered: 0, total: 0, truncated: false, model: null, provider: null };
    }

    // Hard row cap; transcript truncation + overall budget keep the prompt safe.
    const ROW_CAP = 400;
    const TRANSCRIPT_CAP = 1200; // chars per row
    const CHAR_BUDGET = 180_000; // ~45k tokens of row content

    const rows = await this.repo.manager.query<Array<{
      caj: string | null; make: string | null; model: string | null; dealer: string | null;
      allocation_date: Date | null; transcript_text: string | null;
    }>>(
      `SELECT TOP ${ROW_CAP}
        ii.campaign_answers_json AS caj,
        ia.vehicleMake AS make, ia.vehicleModel AS model, ia.dealer AS dealer,
        ${EFF_DATE} AS allocation_date,
        tr.tx AS transcript_text
      ${FROM_SURVEY}
      OUTER APPLY (
        SELECT TOP 1 t.text AS tx FROM app.interaction_transcripts t
        WHERE t.recordingId = ia.id ORDER BY t.createdAt DESC
      ) tr
      ${clause}
      ORDER BY ${EFF_DATE} DESC`,
      params,
    );

    const fmtDate = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : 'n/a');
    let block = '';
    let considered = 0;
    for (const r of rows) {
      let answers: any = {};
      try { answers = r.caj ? JSON.parse(r.caj) : {}; } catch { answers = {}; }
      const tx = (r.transcript_text ?? '').replace(/\s+/g, ' ').trim().slice(0, TRANSCRIPT_CAP);
      const entry =
        `--- Record ${considered + 1} ---\n` +
        `enquired: ${r.make ?? 'n/a'} ${r.model ?? ''}`.trim() + `\n` +
        `dealer: ${r.dealer ?? 'n/a'} | date: ${fmtDate(r.allocation_date)}\n` +
        `survey_answers: ${JSON.stringify(answers)}\n` +
        (tx ? `transcript: ${tx}\n` : '') +
        `\n`;
      if (block.length + entry.length > CHAR_BUDGET) break;
      block += entry;
      considered++;
    }

    const truncated = considered < total;
    const prompt = buildSurveyQaPrompt(q, block, { considered, total, truncated });

    const llm = createProvider(provider as InsightsProviderName | undefined);
    const res = await llm.extract(prompt);
    let answer = '';
    try { answer = (JSON.parse(res.text)?.answer as string) ?? ''; } catch { answer = ''; }
    if (!answer) answer = res.text?.trim() || 'No answer was produced.';

    return { answer, considered, total, truncated, model: res.model, provider: res.provider };
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
        { factor: 'Styling / Design', key: 'styling', count: parseInt(r.styling ?? '0', 10) },
        { factor: 'Brand Reputation', key: 'brand_reputation', count: parseInt(r.brand_reputation ?? '0', 10) },
        { factor: 'Features', key: 'features', count: parseInt(r.features ?? '0', 10) },
        { factor: 'Size / Practicality', key: 'size_practicality', count: parseInt(r.size_practicality ?? '0', 10) },
        { factor: 'Performance', key: 'performance', count: parseInt(r.performance ?? '0', 10) },
        { factor: 'Price / Value', key: 'price_value', count: parseInt(r.price_value ?? '0', 10) },
      ].sort((a, b) => b.count - a.count),
    };
  }

  // ── Not-purchase reasons ──────────────────────────────────────────────────

  async getNotPurchaseReasons(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const baseFilter =
      clause +
      ` AND ${CA('$.meta.flow_status')} = 'Survey Taken' AND ${NOT_PURCHASED}`;

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

    // Sub-reasons: for each reason that carries one, tally its values among the
    // records where that reason flag is set (second level of the breakdown).
    const subFor = async (reasonKey: string) => {
      const reasonPath = SurveyAnalyticsService.REASON_PATHS[reasonKey];
      const subPath = SurveyAnalyticsService.SUB_REASON_PATHS[reasonKey];
      if (!reasonPath || !subPath) return [];
      const subRows = await this.repo.manager.query<Array<{ sub: string; cnt: string }>>(
        `SELECT ${CA(subPath)} AS sub, COUNT(1) AS cnt
         ${FROM_SURVEY} ${baseFilter} AND ${CA(reasonPath)} IN ${TRUTHY}
           AND ${CA(subPath)} IS NOT NULL AND ${CA(subPath)} <> ''
         GROUP BY ${CA(subPath)} ORDER BY COUNT(1) DESC`,
        params,
      );
      return subRows.map((s) => ({ value: s.sub, count: parseInt(s.cnt, 10) }));
    };

    const reasons = [
      { reason: 'Price', key: 'price', count: parseInt(r.price ?? '0', 10) },
      { reason: 'Expectations Not Met', key: 'expectations', count: parseInt(r.expectations ?? '0', 10) },
      { reason: 'Purchased Different Brand', key: 'different_brand', count: parseInt(r.different_brand ?? '0', 10) },
      { reason: 'Purchased Different Model', key: 'different_model', count: parseInt(r.different_model ?? '0', 10) },
      { reason: 'Financing', key: 'financing', count: parseInt(r.financing ?? '0', 10) },
      { reason: 'Dealership Experience', key: 'dealership_experience', count: parseInt(r.dealership_experience ?? '0', 10) },
    ].sort((a, b) => b.count - a.count);

    // Attach sub-reason breakdowns (only the four reasons that have them).
    for (const item of reasons) {
      (item as any).subReasons = await subFor(item.key);
    }

    return { surveyed: parseInt(r.surveyed ?? '0', 10), reasons };
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
  // Reasons that carry a free-text/category sub-reason in the survey data.
  private static readonly SUB_REASON_PATHS: Record<string, string> = {
    price: '$.not_purchased_reasons.price_sub_reason',
    expectations: '$.not_purchased_reasons.expectations_sub_reason',
    financing: '$.not_purchased_reasons.financing_sub_reason',
    dealership_experience: '$.not_purchased_reasons.dealership_experience_sub_reason',
  };
  private static readonly INTEREST_PATHS: Record<string, string> = {
    styling: '$.initial_interest.styling_design',
    brand_reputation: '$.initial_interest.brand_reputation',
    features: '$.initial_interest.features',
    size_practicality: '$.initial_interest.size_practicality',
    performance: '$.initial_interest.performance',
    price_value: '$.initial_interest.price_value',
  };

  async getDrillRecords(
    f: SurveyFilter,
    criteria: {
      competitorMake?: string; chineseOnly?: boolean; excludeChinese?: boolean;
      notPurchaseReason?: string; notPurchaseSubReason?: string; interestFactor?: string; model?: string;
      defectedOnly?: boolean; wonOnly?: boolean;
      flowStatus?: string; stillConsidering?: boolean; ratingScore?: number; dealerVisit?: string;
      ratedOnly?: boolean;
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
    if (criteria.flowStatus) conds.push(`${CA('$.meta.flow_status')} = ${pushParam(criteria.flowStatus)}`);
    if (criteria.stillConsidering) conds.push(`${CA('$.purchase_status.still_considering')} IN ${TRUTHY}`);
    if (criteria.ratingScore != null) conds.push(`TRY_CAST(${CA('$.dealership_rating.score')} AS INT) = ${pushParam(criteria.ratingScore)}`);
    // Match the by-dealer tile, which counts only records that actually have a
    // dealership rating (so the drill total lines up with the chip).
    if (criteria.ratedOnly) conds.push(`${isSet('$.dealership_rating.score')}`);
    if (criteria.dealerVisit) conds.push(`${CA('$.dealer_visit.visited')} = ${pushParam(criteria.dealerVisit)}`);
    if (criteria.notPurchaseReason) {
      const path = SurveyAnalyticsService.REASON_PATHS[criteria.notPurchaseReason];
      if (path) conds.push(`${CA(path)} IN ${TRUTHY}`);
      // Second level: a specific sub-reason within that reason.
      if (criteria.notPurchaseSubReason) {
        const subPath = SurveyAnalyticsService.SUB_REASON_PATHS[criteria.notPurchaseReason];
        if (subPath) conds.push(`${CA(subPath)} = ${pushParam(criteria.notPurchaseSubReason)}`);
      }
    }
    if (criteria.interestFactor) {
      const path = SurveyAnalyticsService.INTEREST_PATHS[criteria.interestFactor];
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
      caj: string | null; ctj: string | null; interaction_id: string; interaction_tps_id: string | null;
      manufacture: string | null; model: string | null; dealer: string | null;
      campaign: string | null; outcome: string | null; recordingUrl: string | null; allocation_date: Date | null;
      transcript_text: string | null; transcript_model: string | null;
    }>>(
      `SELECT TOP 1
        ii.campaign_answers_json AS caj,
        ii.campaign_transcript_json AS ctj,
        ia.id AS interaction_id, ia.interactionTpsId AS interaction_tps_id,
        ia.vehicleMake AS manufacture, ia.vehicleModel AS model, ia.dealer AS dealer,
        ia.campaign AS campaign, ia.outcome AS outcome, ia.recordingUrl AS recordingUrl,
        ${EFF_DATE} AS allocation_date,
        tr.tx AS transcript_text, tr.tmodel AS transcript_model
      ${FROM_SURVEY}
      OUTER APPLY (
        SELECT TOP 1 t.text AS tx, t.model AS tmodel
        FROM app.interaction_transcripts t
        WHERE t.recordingId = ia.id
        ORDER BY t.createdAt DESC
      ) tr
      WHERE ii.conversation_type = 'survey'
        AND (ii.campaign_answers_json IS NOT NULL OR ii.campaign_transcript_json IS NOT NULL)
        AND (CAST(ia.id AS VARCHAR(36)) = @0
             OR CAST(TRY_CAST(${CA('$.meta.id_opportunity')} AS INT) AS VARCHAR(20)) = @0)`,
      [String(id)],
    );

    const row = rows[0];
    if (!row) return null;

    let a: any = {};
    try { a = row.caj ? JSON.parse(row.caj) ?? {} : {}; } catch { a = {}; }
    // Transcript-mined insights (campaign_transcript_json) — surfaced in the
    // drawer so a record drilled from a transcript tile shows its evidence.
    let transcript: any = null;
    try { transcript = row.ctj ? JSON.parse(row.ctj) : null; } catch { transcript = null; }

    return buildSurveyDetail(a, transcript, {
      id,
      interaction_id: row.interaction_id,
      interaction_tps_id: row.interaction_tps_id,
      campaign: row.campaign,
      manufacture: row.manufacture,
      model: row.model,
      dealer: row.dealer,
      allocation_date: row.allocation_date,
      outcome: row.outcome,
      recordingUrl: row.recordingUrl,
      transcript_text: row.transcript_text ?? null,
      transcript_model: row.transcript_model ?? null,
    });
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

    // All surveyed rows per month — the denominator for defection-rate (% mode).
    const surveyedRows = await this.repo.manager.query<Array<{ yr: string; mo: string; count: string }>>(
      `SELECT YEAR(${EFF_DATE}) AS yr, MONTH(${EFF_DATE}) AS mo, COUNT(1) AS count
       ${FROM_SURVEY} ${clause}
       GROUP BY YEAR(${EFF_DATE}), MONTH(${EFF_DATE})`,
      params,
    );

    const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
    const surveyedByMonth = new Map<string, number>();
    for (const r of surveyedRows) surveyedByMonth.set(monthKey(+r.yr, +r.mo), parseInt(r.count, 10));

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
        surveyed: months.map((mk) => surveyedByMonth.get(mk) ?? 0),
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
        { factor: 'Styling / Design', key: 'styling', count: parseInt(r.styling ?? '0', 10) },
        { factor: 'Brand Reputation', key: 'brand_reputation', count: parseInt(r.brand_reputation ?? '0', 10) },
        { factor: 'Features', key: 'features', count: parseInt(r.features ?? '0', 10) },
        { factor: 'Size / Practicality', key: 'size_practicality', count: parseInt(r.size_practicality ?? '0', 10) },
        { factor: 'Performance', key: 'performance', count: parseInt(r.performance ?? '0', 10) },
        { factor: 'Price / Value', key: 'price_value', count: parseInt(r.price_value ?? '0', 10) },
      ].sort((a, b) => b.count - a.count),
      top_models: byModel.slice(0, 10).map((m) => ({ model: m.model, count: parseInt(m.count, 10) })),
    };
  }

  // ── Transcript insights (beyond the survey) ────────────────────────────────
  // Everything here reads campaign_transcript_json — the LLM-mined blob written
  // from the CALL TRANSCRIPT (see call.campaign."NMGB Survey".transcript). It is
  // a SEPARATE column from the survey feed's campaign_answers_json and survives
  // the survey backfill. One combined method → one endpoint → one dashboard
  // section, so the frontend makes a single call.
  async getTranscriptInsights(f: SurveyFilter) {
    const { clause, params } = this.buildWhere(f);
    const tClause = clause + ` AND ii.campaign_transcript_json IS NOT NULL`;
    const CT = (p: string) => `JSON_VALUE(ii.campaign_transcript_json, '${p}')`;
    const q = <T = any>(sql: string) => this.repo.manager.query<T[]>(sql, params);

    const totalRows = await q<{ total: string }>(
      `SELECT COUNT(1) AS total ${FROM_SURVEY} ${tClause}`,
    );
    const total = parseInt(totalRows[0]?.total ?? '0', 10);

    // ── Sentiment (brand / vehicle / dealer): counts per sentiment value ──
    const sentimentRows = await q<{ topic: string; sentiment: string; cnt: string }>(
      `SELECT topic, COALESCE(sentiment, 'not_expressed') AS sentiment, COUNT(1) AS cnt FROM (
         SELECT 'brand' AS topic, ${CT('$.current_brand_sentiment.sentiment')} AS sentiment ${FROM_SURVEY} ${tClause}
         UNION ALL
         SELECT 'vehicle', ${CT('$.current_vehicle_sentiment.sentiment')} ${FROM_SURVEY} ${tClause}
         UNION ALL
         SELECT 'dealer', ${CT('$.dealer_sentiment.sentiment')} ${FROM_SURVEY} ${tClause}
       ) x GROUP BY topic, sentiment`,
    );
    const sentiment: Record<string, Record<string, number>> = { brand: {}, vehicle: {}, dealer: {} };
    for (const r of sentimentRows) {
      (sentiment[r.topic] ??= {})[r.sentiment] = parseInt(r.cnt, 10);
    }

    // ── Competitors considered (make + model, Chinese-tagged in code) ──
    const competitorRows = await q<{ brand: string; model: string | null; status: string | null; cnt: string }>(
      `SELECT b.brand AS brand, b.model AS model, b.status AS status, COUNT(1) AS cnt
       ${FROM_SURVEY}
       CROSS APPLY OPENJSON(ii.campaign_transcript_json, '$.competitor_considered.brands')
         WITH (brand nvarchar(200) '$.brand', model nvarchar(200) '$.model', status varchar(30) '$.status') b
       ${tClause} AND b.brand IS NOT NULL AND b.brand <> ''
       GROUP BY b.brand, b.model, b.status`,
    );
    const brandMap = new Map<string, { brand: string; count: number; chinese: boolean; models: Set<string> }>();
    for (const r of competitorRows) {
      const key = (r.brand ?? '').trim();
      if (!key) continue;
      const e = brandMap.get(key) ?? { brand: key, count: 0, chinese: isChineseOem(key), models: new Set<string>() };
      e.count += parseInt(r.cnt, 10);
      if (r.model && r.model.trim()) e.models.add(r.model.trim());
      brandMap.set(key, e);
    }
    const competitorBrands = [...brandMap.values()]
      .map((e) => ({ brand: e.brand, count: e.count, chinese: e.chinese, models: [...e.models] }))
      .sort((a, b) => b.count - a.count);
    const consideredTotal = competitorBrands.reduce((a, b) => a + b.count, 0);
    const chineseConsidered = competitorBrands.filter((b) => b.chinese).reduce((a, b) => a + b.count, 0);

    // ── Competitor reasons, split by whether the record considered a Chinese OEM ──
    // The model's separate `chinese_specific_reasons` field is unreliable/empty,
    // so instead we classify each record by its considered brands (isChineseOem)
    // and bucket its `competitor_reasons.reasons` into Chinese vs non-Chinese.
    const reasonRecordRows = await q<{ reasons: string | null; brands: string | null }>(
      `SELECT JSON_QUERY(ii.campaign_transcript_json, '$.competitor_reasons.reasons') AS reasons,
              JSON_QUERY(ii.campaign_transcript_json, '$.competitor_considered.brands') AS brands
       ${FROM_SURVEY} ${tClause}
         AND JSON_QUERY(ii.campaign_transcript_json, '$.competitor_reasons.reasons') IS NOT NULL`,
    );
    const allMap = new Map<string, number>();
    const chineseMap = new Map<string, number>();
    const nonChineseMap = new Map<string, number>();
    for (const row of reasonRecordRows) {
      let reasonList: any[] = [];
      let brandList: Array<{ brand?: string }> = [];
      try { reasonList = JSON.parse(row.reasons || '[]'); } catch { /* skip */ }
      try { brandList = JSON.parse(row.brands || '[]'); } catch { /* skip */ }
      if (!Array.isArray(reasonList) || !reasonList.length) continue;
      const isChinese = Array.isArray(brandList) && brandList.some((b) => b?.brand && isChineseOem(b.brand));
      const bucket = isChinese ? chineseMap : nonChineseMap;
      for (const raw of reasonList) {
        const key = String(raw ?? '').trim();
        if (!key) continue;
        allMap.set(key, (allMap.get(key) ?? 0) + 1);
        bucket.set(key, (bucket.get(key) ?? 0) + 1);
      }
    }
    const toReasonList = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, label: INFLUENCE_LABELS[key] ?? key, count }))
        .sort((a, b) => b.count - a.count);
    const reasons = toReasonList(allMap);
    const chineseReasons = toReasonList(chineseMap);
    const nonChineseReasons = toReasonList(nonChineseMap);

    // ── Frustrations (theme / severity / owner / resolvability + samples) ──
    const frustrationRows = await q<{
      theme: string; severity: string; root_cause_owner: string; resolvable: string;
      recommended_action: string; quote: string;
    }>(
      `SELECT fr.theme, fr.severity, fr.root_cause_owner, fr.resolvable, fr.recommended_action, fr.quote
       ${FROM_SURVEY}
       CROSS APPLY OPENJSON(ii.campaign_transcript_json, '$.frustrations')
         WITH (theme nvarchar(300) '$.theme', severity varchar(20) '$.severity',
               root_cause_owner varchar(40) '$.root_cause_owner', resolvable varchar(20) '$.resolvable',
               recommended_action nvarchar(600) '$.recommended_action', quote nvarchar(600) '$.quote') fr
       ${tClause} AND fr.theme IS NOT NULL AND fr.theme <> ''`,
    );
    const tally = (rows: any[], field: string) => {
      const m: Record<string, number> = {};
      for (const r of rows) { const k = (r[field] ?? 'unknown') || 'unknown'; m[k] = (m[k] ?? 0) + 1; }
      return m;
    };
    const themeCounts = tally(frustrationRows, 'theme');
    const frustrations = {
      total: frustrationRows.length,
      by_severity: tally(frustrationRows, 'severity'),
      by_owner: tally(frustrationRows, 'root_cause_owner'),
      by_resolvable: tally(frustrationRows, 'resolvable'),
      top_themes: Object.entries(themeCounts)
        .map(([theme, count]) => ({ theme, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      // Prioritise high-severity, resolvable frustrations — the actionable list.
      samples: frustrationRows
        .filter((r) => r.quote || r.recommended_action)
        .sort((a, b) => sevRank(b.severity) - sevRank(a.severity))
        .slice(0, 30)
        .map((r) => ({
          theme: r.theme, severity: r.severity, owner: r.root_cause_owner,
          resolvable: r.resolvable, recommended_action: r.recommended_action, quote: r.quote,
        })),
    };

    // ── Reportable measures the survey misses ──
    const measureRows = await q<{ price_gap_yes: string; follow_up_yes: string; follow_up_no: string }>(
      `SELECT
         SUM(CASE WHEN ${CT('$.price_expectation_gap.answer')} = 'yes' THEN 1 ELSE 0 END) AS price_gap_yes,
         SUM(CASE WHEN ${CT('$.dealer_follow_up.answer')} = 'yes' THEN 1 ELSE 0 END) AS follow_up_yes,
         SUM(CASE WHEN ${CT('$.dealer_follow_up.answer')} = 'no' THEN 1 ELSE 0 END) AS follow_up_no
       ${FROM_SURVEY} ${tClause}`,
    );
    const evRows = await q<{ stance: string; cnt: string }>(
      `SELECT COALESCE(${CT('$.ev_sentiment.stance')}, 'not_applicable') AS stance, COUNT(1) AS cnt
       ${FROM_SURVEY} ${tClause} GROUP BY ${CT('$.ev_sentiment.stance')}`,
    );
    const loyaltyRows = await q<{ answer: string; cnt: string }>(
      `SELECT COALESCE(${CT('$.loyalty_signal.answer')}, 'unknown') AS answer, COUNT(1) AS cnt
       ${FROM_SURVEY} ${tClause} GROUP BY ${CT('$.loyalty_signal.answer')}`,
    );
    const measures = {
      price_expectation_gap_yes: parseInt(measureRows[0]?.price_gap_yes ?? '0', 10),
      dealer_follow_up_yes: parseInt(measureRows[0]?.follow_up_yes ?? '0', 10),
      dealer_follow_up_no: parseInt(measureRows[0]?.follow_up_no ?? '0', 10),
      ev_sentiment: evRows.map((r) => ({ stance: r.stance, count: parseInt(r.cnt, 10) })),
      loyalty: loyaltyRows.map((r) => ({ answer: r.answer, count: parseInt(r.cnt, 10) })),
    };

    // ── Report-ready quotes + explicit survey-gap notes ──
    const quotes = (await q<{ theme: string; quote: string; sentiment: string }>(
      `SELECT TOP 60 kq.theme, kq.quote, kq.sentiment
       ${FROM_SURVEY}
       CROSS APPLY OPENJSON(ii.campaign_transcript_json, '$.key_quotes')
         WITH (theme nvarchar(200) '$.theme', quote nvarchar(600) '$.quote', sentiment varchar(20) '$.sentiment') kq
       ${tClause} AND kq.quote IS NOT NULL AND kq.quote <> ''`,
    )).map((r) => ({ theme: r.theme, quote: r.quote, sentiment: r.sentiment }));

    const gaps = (await q<{ gap: string }>(
      `SELECT TOP 60 g.value AS gap
       ${FROM_SURVEY} CROSS APPLY OPENJSON(ii.campaign_transcript_json, '$.survey_gaps_filled') g
       ${tClause} AND g.value IS NOT NULL AND g.value <> ''`,
    )).map((r) => r.gap);

    return {
      total_with_transcript: total,
      sentiment,
      competitors: {
        considered_total: consideredTotal,
        chinese_considered: chineseConsidered,
        chinese_share: consideredTotal ? Math.round((chineseConsidered / consideredTotal) * 100) : 0,
        brands: competitorBrands,
      },
      reasons,
      chinese_reasons: chineseReasons,
      non_chinese_reasons: nonChineseReasons,
      frustrations,
      measures,
      quotes,
      gaps,
    };
  }

  // ── Transcript drill: individual records behind a transcript-insight tile ──
  // Mirrors getDrillRecords but filters on campaign_transcript_json. Reuses the
  // same recordSelect() projection so the existing detail drawer works unchanged.
  // Gated identically to getTranscriptInsights (buildWhere + transcript not null)
  // so a drill row-count matches the tile it was launched from.
  async getTranscriptDrillRecords(
    f: SurveyFilter,
    criteria: {
      sentimentTopic?: string; sentimentValue?: string;
      transcriptBrand?: string; transcriptChineseOnly?: boolean; transcriptNonChineseOnly?: boolean;
      competitorReason?: string; chineseReason?: string;
      frustrationTheme?: string; frustrationSeverity?: string; frustrationResolvable?: string;
      priceGap?: boolean; dealerFollowUp?: string; evStance?: string; loyaltyAnswer?: string;
    },
    limit = 200,
    offset = 0,
  ) {
    const { clause, params } = this.buildWhere(f);
    const CT = (p: string) => `JSON_VALUE(ii.campaign_transcript_json, '${p}')`;
    const conds: string[] = [`ii.campaign_transcript_json IS NOT NULL`];
    const extra: any[] = [];
    const pushParam = (v: any) => { extra.push(v); return `@${params.length + extra.length - 1}`; };

    const SENT_PATH: Record<string, string> = {
      brand: '$.current_brand_sentiment.sentiment',
      vehicle: '$.current_vehicle_sentiment.sentiment',
      dealer: '$.dealer_sentiment.sentiment',
    };
    if (criteria.sentimentTopic && criteria.sentimentValue) {
      const path = SENT_PATH[criteria.sentimentTopic];
      if (path) conds.push(`COALESCE(${CT(path)}, 'not_expressed') = ${pushParam(criteria.sentimentValue)}`);
    }
    if (criteria.transcriptBrand) {
      conds.push(
        `EXISTS (SELECT 1 FROM OPENJSON(ii.campaign_transcript_json, '$.competitor_considered.brands') ` +
          `WITH (brand nvarchar(200) '$.brand') b WHERE b.brand = ${pushParam(criteria.transcriptBrand)})`,
      );
    }
    if (criteria.competitorReason) {
      conds.push(
        `EXISTS (SELECT 1 FROM OPENJSON(ii.campaign_transcript_json, '$.competitor_reasons.reasons') r ` +
          `WHERE r.value = ${pushParam(criteria.competitorReason)})`,
      );
    }
    if (criteria.chineseReason) {
      conds.push(
        `EXISTS (SELECT 1 FROM OPENJSON(ii.campaign_transcript_json, '$.competitor_reasons.chinese_specific_reasons') r ` +
          `WHERE r.value = ${pushParam(criteria.chineseReason)})`,
      );
    }
    if (criteria.frustrationTheme || criteria.frustrationSeverity || criteria.frustrationResolvable) {
      const frConds: string[] = [];
      if (criteria.frustrationTheme) frConds.push(`fr.theme = ${pushParam(criteria.frustrationTheme)}`);
      if (criteria.frustrationSeverity) frConds.push(`fr.severity = ${pushParam(criteria.frustrationSeverity)}`);
      if (criteria.frustrationResolvable) frConds.push(`fr.resolvable = ${pushParam(criteria.frustrationResolvable)}`);
      conds.push(
        `EXISTS (SELECT 1 FROM OPENJSON(ii.campaign_transcript_json, '$.frustrations') ` +
          `WITH (theme nvarchar(300) '$.theme', severity varchar(20) '$.severity', resolvable varchar(20) '$.resolvable') fr ` +
          `WHERE ${frConds.join(' AND ')})`,
      );
    }
    if (criteria.priceGap) conds.push(`${CT('$.price_expectation_gap.answer')} = 'yes'`);
    if (criteria.dealerFollowUp) conds.push(`${CT('$.dealer_follow_up.answer')} = ${pushParam(criteria.dealerFollowUp)}`);
    if (criteria.evStance) conds.push(`COALESCE(${CT('$.ev_sentiment.stance')}, 'not_applicable') = ${pushParam(criteria.evStance)}`);
    if (criteria.loyaltyAnswer) conds.push(`COALESCE(${CT('$.loyalty_signal.answer')}, 'unknown') = ${pushParam(criteria.loyaltyAnswer)}`);

    // Chinese-only over transcript brand mentions: classify in JS (same as the
    // tile), then constrain to those makes.
    if (criteria.transcriptChineseOnly) {
      const brandRows = await this.repo.manager.query<Array<{ brand: string }>>(
        `SELECT DISTINCT b.brand AS brand
         ${FROM_SURVEY}
         CROSS APPLY OPENJSON(ii.campaign_transcript_json, '$.competitor_considered.brands')
           WITH (brand nvarchar(200) '$.brand') b
         ${clause} AND ii.campaign_transcript_json IS NOT NULL AND b.brand IS NOT NULL AND b.brand <> ''`,
        params,
      );
      const chineseMakes = brandRows.map((r) => r.brand).filter((m) => isChineseOem(m));
      if (chineseMakes.length) {
        const ph = chineseMakes.map((m) => pushParam(m));
        conds.push(
          `EXISTS (SELECT 1 FROM OPENJSON(ii.campaign_transcript_json, '$.competitor_considered.brands') ` +
            `WITH (brand nvarchar(200) '$.brand') b WHERE b.brand IN (${ph.join(', ')}))`,
        );
      } else {
        conds.push('1 = 0');
      }
    }

    // Records that considered a competitor but NONE that are Chinese OEMs.
    if (criteria.transcriptNonChineseOnly) {
      const brandRows = await this.repo.manager.query<Array<{ brand: string }>>(
        `SELECT DISTINCT b.brand AS brand
         ${FROM_SURVEY}
         CROSS APPLY OPENJSON(ii.campaign_transcript_json, '$.competitor_considered.brands')
           WITH (brand nvarchar(200) '$.brand') b
         ${clause} AND ii.campaign_transcript_json IS NOT NULL AND b.brand IS NOT NULL AND b.brand <> ''`,
        params,
      );
      const chineseMakes = brandRows.map((r) => r.brand).filter((m) => isChineseOem(m));
      // Must have at least one considered brand, and no considered brand Chinese.
      conds.push(
        `EXISTS (SELECT 1 FROM OPENJSON(ii.campaign_transcript_json, '$.competitor_considered.brands') ` +
          `WITH (brand nvarchar(200) '$.brand') b WHERE b.brand IS NOT NULL AND b.brand <> '')`,
      );
      if (chineseMakes.length) {
        const ph = chineseMakes.map((m) => pushParam(m));
        conds.push(
          `NOT EXISTS (SELECT 1 FROM OPENJSON(ii.campaign_transcript_json, '$.competitor_considered.brands') ` +
            `WITH (brand nvarchar(200) '$.brand') b WHERE b.brand IN (${ph.join(', ')}))`,
        );
      }
    }

    const whereFull = clause + ' AND ' + conds.join(' AND ');
    const offIdx = params.length + extra.length;

    const rows = await this.repo.manager.query<any[]>(
      `SELECT ${this.recordSelect()}, ii.campaign_transcript_json AS ctj
       ${FROM_SURVEY} ${whereFull}
       ORDER BY ${EFF_DATE} DESC
       OFFSET @${offIdx} ROWS FETCH NEXT @${offIdx + 1} ROWS ONLY`,
      [...params, ...extra, offset, limit],
    );

    // Attach the quote/detail that actually matches the drilled dimension, so a
    // frustration-theme drill shows THAT frustration's quote rather than the
    // generic purchase_reason shared across every tile.
    return rows.map((r) => {
      let t: any = null;
      try { t = r.ctj ? JSON.parse(r.ctj) : null; } catch { t = null; }
      const { ctj, ...rest } = r;
      return { ...rest, evidence: transcriptEvidence(t, criteria) };
    });
  }
}

// Pull the piece of the transcript blob relevant to the drilled criteria.
function firstStr(...vals: any[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}
function transcriptEvidence(
  t: any,
  c: {
    sentimentTopic?: string; transcriptBrand?: string;
    competitorReason?: string; chineseReason?: string;
    frustrationTheme?: string; frustrationSeverity?: string; frustrationResolvable?: string;
    priceGap?: boolean; dealerFollowUp?: string; evStance?: string; loyaltyAnswer?: string;
  },
): string | null {
  if (!t) return null;
  if (c.frustrationTheme || c.frustrationSeverity || c.frustrationResolvable) {
    const fr = (t.frustrations ?? []).find(
      (f: any) =>
        (!c.frustrationTheme || f.theme === c.frustrationTheme) &&
        (!c.frustrationSeverity || f.severity === c.frustrationSeverity) &&
        (!c.frustrationResolvable || f.resolvable === c.frustrationResolvable),
    );
    if (fr) return firstStr(fr.quote, fr.recommended_action, fr.theme);
  }
  if (c.competitorReason || c.chineseReason) {
    return firstStr(t.competitor_reasons?.quote, t.competitor_reasons?.detail);
  }
  if (c.sentimentTopic) {
    const key =
      c.sentimentTopic === 'brand' ? 'current_brand_sentiment'
        : c.sentimentTopic === 'vehicle' ? 'current_vehicle_sentiment'
          : c.sentimentTopic === 'dealer' ? 'dealer_sentiment' : null;
    const s = key ? t[key] : null;
    if (s) return firstStr(s.quote, s.evidence, s.detail);
  }
  if (c.transcriptBrand) {
    const b = (t.competitor_considered?.brands ?? []).find((x: any) => x.brand === c.transcriptBrand);
    if (b) return firstStr(b.quote, b.context, [b.brand, b.model].filter(Boolean).join(' '));
  }
  if (c.loyaltyAnswer) return firstStr(t.loyalty_signal?.quote, t.loyalty_signal?.detail);
  if (c.evStance) return firstStr(t.ev_sentiment?.quote, t.ev_sentiment?.detail);
  if (c.dealerFollowUp) return firstStr(t.dealer_follow_up?.quote, t.dealer_follow_up?.detail);
  if (c.priceGap) return firstStr(t.price_expectation_gap?.quote, t.price_expectation_gap?.detail);
  return firstStr(t.key_quotes?.[0]?.quote);
}

// High → low severity ordering for the frustration sample list.
function sevRank(sev?: string): number {
  return sev === 'high' ? 3 : sev === 'medium' ? 2 : sev === 'low' ? 1 : 0;
}
