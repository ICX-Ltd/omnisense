import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';

import { InteractionCsat } from '../db/entities/interaction-csat.entity';
import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { PromptsService } from '../modules/prompts/prompts.service';
import { createProvider } from '../insights/providers/provider.factory';
import { cleanJsonText } from '../insights/insights.service';
import { InsightsProviderName } from '../insights/types/insights-provider.type';

// Only CSATs at/below this score (out of 5) are assessed — 4 and 5 are excluded
// (the framework is about contesting negative scores). Env-overridable.
const CSAT_MAX_SCORE = Number(process.env.CSAT_ASSESS_MAX_SCORE) || 3;

// A reviewer comment stored on a CSAT record (reviewerCommentsJson array).
export interface CsatReviewerComment {
  user: string | null;
  comment: string;
  at: string; // ISO timestamp
}

// One CSAT survey result arriving from the third-party feed.
export interface CsatFeedItem {
  interactionTpsId: string;
  score?: number | null;
  scoreMax?: number | null;
  comment?: string | null;
  campaign?: string | null;
  respondedAt?: string | null;
}

@Injectable()
export class CsatService {
  private readonly logger = new Logger(CsatService.name);

  constructor(
    @InjectRepository(InteractionCsat)
    private readonly csatRepo: Repository<InteractionCsat>,
    @InjectRepository(Interaction)
    private readonly interactionsRepo: Repository<Interaction>,
    @InjectRepository(InteractionTranscript)
    private readonly transcriptsRepo: Repository<InteractionTranscript>,
    private readonly prompts: PromptsService,
  ) {}

  // ─── Ingest (webhook feed) ─────────────────────────────────────────────────
  // Upsert one-or-many CSAT rows keyed by interactionTpsId, matching each to an
  // interaction so the assessment can run against its transcript later. Returns a
  // small summary. Unmatched rows are still stored (status 'unmatched') so nothing
  // is lost — they re-match on the next ingest once the interaction exists.
  async ingest(items: CsatFeedItem[]) {
    let matched = 0;
    let unmatched = 0;
    let upserted = 0;

    for (const item of items) {
      const tpsId = String(item.interactionTpsId ?? '').trim();
      if (!tpsId) continue;

      const interaction = await this.interactionsRepo.findOne({
        where: { interactionTpsId: tpsId },
      });

      const existing = await this.csatRepo.findOne({
        where: { interactionTpsId: tpsId },
      });

      const respondedAt = item.respondedAt ? new Date(item.respondedAt) : null;
      const campaign = item.campaign ?? interaction?.campaign ?? existing?.campaign ?? null;
      const effScore = item.score ?? existing?.score ?? null;

      // Preserve an existing assessment; otherwise: exclude 4-5 scores from
      // assessment (only <= CSAT_MAX_SCORE are contest-assessed), mark unmatched
      // when no interaction, else queue as pending.
      const alreadyAssessed = existing?.status === 'assessed';
      const status = !interaction
        ? 'unmatched'
        : alreadyAssessed
          ? 'assessed'
          : effScore != null && effScore > CSAT_MAX_SCORE
            ? 'excluded'
            : 'pending';

      const row = this.csatRepo.create({
        ...(existing ?? {}),
        interactionTpsId: tpsId,
        recordingId: interaction?.id ?? existing?.recordingId ?? null,
        campaign,
        score: item.score ?? existing?.score ?? null,
        scoreMax: item.scoreMax ?? existing?.scoreMax ?? null,
        comment: item.comment ?? existing?.comment ?? null,
        respondedAt: respondedAt ?? existing?.respondedAt ?? null,
        rawFeedJson: JSON.stringify(item),
        status,
      });
      await this.csatRepo.save(row);
      upserted++;

      if (interaction) {
        matched++;
        if (!interaction.hasCsat) {
          await this.interactionsRepo.update(interaction.id, { hasCsat: true });
        }
      } else {
        unmatched++;
      }
    }

    return { received: items.length, upserted, matched, unmatched };
  }

  // Re-attempt matching for rows imported before their interaction existed.
  async rematchUnmatched() {
    const rows = await this.csatRepo.find({ where: { status: 'unmatched' } });
    let matched = 0;
    for (const row of rows) {
      const interaction = await this.interactionsRepo.findOne({
        where: { interactionTpsId: row.interactionTpsId },
      });
      if (interaction) {
        row.recordingId = interaction.id;
        row.campaign = row.campaign ?? interaction.campaign ?? null;
        row.status = 'pending';
        await this.csatRepo.save(row);
        if (!interaction.hasCsat) {
          await this.interactionsRepo.update(interaction.id, { hasCsat: true });
        }
        matched++;
      }
    }
    return { rematched: matched };
  }

  // ─── Board metrics ─────────────────────────────────────────────────────────
  async board() {
    const byStatus = await this.csatRepo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .groupBy('c.status')
      .getRawMany<{ status: string; count: string }>();

    const byDecision = await this.csatRepo
      .createQueryBuilder('c')
      .select("COALESCE(c.decision, 'unassessed')", 'decision')
      .addSelect('COUNT(1)', 'count')
      .where('c.status = :s', { s: 'assessed' })
      .groupBy("COALESCE(c.decision, 'unassessed')")
      .getRawMany<{ decision: string; count: string }>();

    const byCampaign = await this.csatRepo
      .createQueryBuilder('c')
      .select("COALESCE(c.campaign, 'unknown')", 'campaign')
      .addSelect('COUNT(1)', 'total')
      .addSelect("SUM(CASE WHEN c.decision = 'contest' THEN 1 ELSE 0 END)", 'contest')
      .addSelect("SUM(CASE WHEN c.decision = 'do_not_contest' THEN 1 ELSE 0 END)", 'do_not_contest')
      .addSelect("SUM(CASE WHEN c.status = 'assessed' THEN 1 ELSE 0 END)", 'assessed')
      .groupBy("COALESCE(c.campaign, 'unknown')")
      .orderBy('total', 'DESC')
      .getRawMany<{ campaign: string; total: string; contest: string; do_not_contest: string; assessed: string }>();

    // Monthly contest / do-not-contest counts for the headline sparklines.
    const decisionTrend = await this.csatRepo
      .createQueryBuilder('c')
      .select("FORMAT(COALESCE(c.respondedAt, c.createdAt), 'yyyy-MM')", 'ym')
      .addSelect("SUM(CASE WHEN c.decision = 'contest' THEN 1 ELSE 0 END)", 'contest')
      .addSelect("SUM(CASE WHEN c.decision = 'do_not_contest' THEN 1 ELSE 0 END)", 'do_not_contest')
      .where("c.status = 'assessed'")
      .groupBy("FORMAT(COALESCE(c.respondedAt, c.createdAt), 'yyyy-MM')")
      .orderBy('ym', 'ASC')
      .getRawMany<{ ym: string; contest: string; do_not_contest: string }>();

    // Supervisor review outcomes. "Raise with client" (accept a contest OR
    // disagree with a do-not-contest) is the key exported metric.
    const byReview = await this.csatRepo
      .createQueryBuilder('c')
      .select("SUM(CASE WHEN c.reviewOutcome = 'raise_with_client' THEN 1 ELSE 0 END)", 'raise_with_client')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'do_not_raise' THEN 1 ELSE 0 END)", 'do_not_raise')
      .addSelect("SUM(CASE WHEN c.status = 'assessed' AND c.reviewOutcome IS NULL THEN 1 ELSE 0 END)", 'pending_review')
      .getRawOne<{ raise_with_client: string; do_not_raise: string; pending_review: string }>();

    // Monthly raise-with-client / do-not-raise counts (by review date) for the
    // headline sparklines.
    const reviewTrend = await this.csatRepo
      .createQueryBuilder('c')
      .select("FORMAT(c.reviewedAt, 'yyyy-MM')", 'ym')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'raise_with_client' THEN 1 ELSE 0 END)", 'raise_with_client')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'do_not_raise' THEN 1 ELSE 0 END)", 'do_not_raise')
      .where('c.reviewOutcome IS NOT NULL AND c.reviewedAt IS NOT NULL')
      .groupBy("FORMAT(c.reviewedAt, 'yyyy-MM')")
      .orderBy('ym', 'ASC')
      .getRawMany<{ ym: string; raise_with_client: string; do_not_raise: string }>();

    const num = (v: string | number | null | undefined) => Number(v) || 0;
    const statusCounts: Record<string, number> = {};
    for (const r of byStatus) statusCounts[r.status] = num(r.count);
    const total = Object.values(statusCounts).reduce((s, n) => s + n, 0);

    return {
      total,
      status: statusCounts,
      pending:
        num(statusCounts['pending']) +
        num(statusCounts['awaiting_transcript']) +
        num(statusCounts['assessing']),
      assessed: num(statusCounts['assessed']),
      errors: num(statusCounts['error']),
      unmatched: num(statusCounts['unmatched']),
      excluded: num(statusCounts['excluded']),
      decisions: byDecision.map((r) => ({ decision: r.decision, count: num(r.count) })),
      decisionTrend: decisionTrend.map((r) => ({ ym: r.ym, contest: num(r.contest), do_not_contest: num(r.do_not_contest) })),
      reviews: {
        raiseWithClient: num(byReview?.raise_with_client),
        doNotRaise: num(byReview?.do_not_raise),
        pendingReview: num(byReview?.pending_review),
      },
      reviewTrend: reviewTrend.map((r) => ({
        ym: r.ym,
        raiseWithClient: num(r.raise_with_client),
        doNotRaise: num(r.do_not_raise),
      })),
      byCampaign: byCampaign.map((r) => ({
        campaign: r.campaign,
        total: num(r.total),
        assessed: num(r.assessed),
        contest: num(r.contest),
        do_not_contest: num(r.do_not_contest),
      })),
    };
  }

  // ─── List (board table) ────────────────────────────────────────────────────
  async list(opts: { status?: string; decision?: string; campaign?: string; reviewOutcome?: string; limit?: number }) {
    const qb = this.csatRepo
      .createQueryBuilder('c')
      .leftJoin(Interaction, 'ia', 'ia.id = c.recordingId')
      .select([
        'c.id AS id',
        'c.interactionTpsId AS interactionTpsId',
        'c.recordingId AS recordingId',
        'c.campaign AS campaign',
        'c.score AS score',
        'c.scoreMax AS scoreMax',
        'c.status AS status',
        'c.decision AS decision',
        'c.confidence AS confidence',
        'c.dissatisfaction_source AS dissatisfaction_source',
        'c.rationale AS rationale',
        'c.comment AS comment',
        'c.reviewOutcome AS reviewOutcome',
        'c.reviewAction AS reviewAction',
        'c.reviewedBy AS reviewedBy',
        'c.reviewedAt AS reviewedAt',
        'c.assessedAt AS assessedAt',
        'c.createdAt AS createdAt',
        'ia.agent AS agent',
        'ia.interactionId AS interactionId',
        'ia.interactionDateTime AS interactionDateTime',
      ])
      .orderBy('c.createdAt', 'DESC')
      .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));

    if (opts.status) qb.andWhere('c.status = :st', { st: opts.status });
    if (opts.decision) qb.andWhere('c.decision = :dc', { dc: opts.decision });
    if (opts.campaign) qb.andWhere('c.campaign = :cp', { cp: opts.campaign });
    if (opts.reviewOutcome) qb.andWhere('c.reviewOutcome = :ro', { ro: opts.reviewOutcome });

    return qb.getRawMany();
  }

  async getDetail(id: string) {
    const row = await this.csatRepo.findOne({ where: { id } });
    if (!row) return null;
    return {
      ...row,
      parsed: row.json ? safeParse(row.json) : null,
      comments: row.reviewerCommentsJson ? safeParse(row.reviewerCommentsJson) ?? [] : [],
    };
  }

  // Record a supervisor review: they ACCEPT the AI decision or DISAGREE with it.
  // The business outcome is derived: "raise with client" when they accept a
  // CONTEST or disagree with a DO NOT CONTEST (those get exported/passed back),
  // else "do not raise". Stamps who + when.
  async setReview(id: string, action: string, user: string | null) {
    const act = (action ?? '').trim().toLowerCase();
    if (act !== 'accept' && act !== 'disagree' && act !== 'clear') {
      throw new BadRequestException("action must be 'accept', 'disagree' or 'clear'");
    }
    const row = await this.csatRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('CSAT record not found');

    if (act === 'clear') {
      // Full deselection — record is back to un-reviewed.
      row.reviewAction = null;
      row.reviewOutcome = null;
      row.reviewedBy = null;
      row.reviewedAt = null;
    } else {
      // AI said contest? Accepting a contest, or disagreeing with a non-contest,
      // both mean "raise with client".
      const aiContest = row.decision === 'contest';
      const raise = act === 'accept' ? aiContest : !aiContest;

      row.reviewAction = act;
      row.reviewOutcome = raise ? 'raise_with_client' : 'do_not_raise';
      row.reviewedBy = (user ?? '').trim() || null;
      row.reviewedAt = new Date();
    }
    await this.csatRepo.save(row);
    return {
      reviewOutcome: row.reviewOutcome,
      reviewAction: row.reviewAction,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
    };
  }

  // Append a reviewer comment (user + timestamp + text) to a CSAT record.
  async addComment(id: string, user: string | null, comment: string) {
    const text = (comment ?? '').trim();
    if (!text) throw new BadRequestException('comment is required');
    const row = await this.csatRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('CSAT record not found');

    const list: CsatReviewerComment[] = row.reviewerCommentsJson
      ? safeParse(row.reviewerCommentsJson) ?? []
      : [];
    list.push({
      user: (user ?? '').trim() || null,
      comment: text,
      at: new Date().toISOString(),
    });
    row.reviewerCommentsJson = JSON.stringify(list);
    await this.csatRepo.save(row);
    return { comments: list };
  }

  // ─── Batch assessment ──────────────────────────────────────────────────────
  // Process up to `limit` pending CSAT rows that have a matched interaction with
  // a transcript. Sequential — CSAT volumes are low relative to insights.
  async runBatch(limit: number, provider?: InsightsProviderName, model?: string) {
    // Reclassify any queued 4-5 scores that predate the exclusion rule.
    await this.csatRepo
      .createQueryBuilder()
      .update(InteractionCsat)
      .set({ status: 'excluded' })
      .where('status IN (:...s) AND score IS NOT NULL AND score > :max', {
        s: ['pending', 'awaiting_transcript'],
        max: CSAT_MAX_SCORE,
      })
      .execute();

    const candidates = await this.csatRepo.find({
      where: {
        status: In(['pending', 'awaiting_transcript']),
        recordingId: Not(IsNull()),
        score: LessThanOrEqual(CSAT_MAX_SCORE),
      },
      order: { createdAt: 'ASC' },
      take: Math.min(Math.max(limit, 1), 500),
    });

    let assessed = 0;
    let awaiting = 0;
    let errored = 0;

    for (const row of candidates) {
      try {
        const done = await this.assessOne(row.id, provider, model);
        if (done === 'assessed') assessed++;
        else if (done === 'awaiting_transcript') awaiting++;
        else errored++;
      } catch (e: any) {
        errored++;
        this.logger.error(`CSAT assess failed for ${row.id}: ${e?.message ?? e}`);
      }
    }

    return { processed: candidates.length, assessed, awaiting_transcript: awaiting, errored };
  }

  async assessOne(
    id: string,
    provider?: InsightsProviderName,
    model?: string,
  ): Promise<'assessed' | 'awaiting_transcript' | 'error'> {
    const row = await this.csatRepo.findOne({ where: { id } });
    if (!row) return 'error';
    if (row.score != null && row.score > CSAT_MAX_SCORE) {
      await this.csatRepo.update(id, { status: 'excluded' });
      return 'error';
    }
    if (!row.recordingId) {
      await this.csatRepo.update(id, { status: 'unmatched' });
      return 'error';
    }

    const transcript = await this.transcriptsRepo.findOne({
      where: { recordingId: row.recordingId },
    });
    if (!transcript?.text?.trim()) {
      await this.csatRepo.update(id, { status: 'awaiting_transcript' });
      return 'awaiting_transcript';
    }

    await this.csatRepo.update(id, { status: 'assessing', lastError: null });

    const { prompt, promptVersions } = await this.prompts.composeCsatPrompt(
      transcript.text,
      row.campaign,
      row.score,
      row.comment,
    );

    try {
      const llm = createProvider(provider, model);
      const result = await llm.extract(prompt);
      const parsed = safeParse(cleanJsonText(result.text));
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('LLM returned no parseable JSON');
      }

      const decision = normaliseDecision(parsed.decision);
      await this.csatRepo.update(id, {
        status: 'assessed',
        decision,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        dissatisfaction_source:
          typeof parsed.dissatisfaction_source === 'string'
            ? parsed.dissatisfaction_source.slice(0, 40)
            : null,
        agent_materially_contributed:
          typeof parsed.agent_materially_contributed === 'boolean'
            ? parsed.agent_materially_contributed
            : null,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null,
        json: cleanJsonText(result.text),
        providerUsed: result.provider,
        model: result.model,
        prompt_versions_json:
          promptVersions && Object.keys(promptVersions).length
            ? JSON.stringify(promptVersions)
            : null,
        input_tokens: result.usage?.inputTokens ?? null,
        output_tokens: result.usage?.outputTokens ?? null,
        attempts: 1,
        assessedAt: new Date(),
        lastError: null,
      });
      return 'assessed';
    } catch (e: any) {
      await this.csatRepo.update(id, {
        status: 'error',
        lastError: String(e?.message ?? e).slice(0, 1000),
      });
      return 'error';
    }
  }

  async requeue(id: string) {
    const row = await this.csatRepo.findOne({ where: { id } });
    if (!row) return { ok: false };
    const status =
      row.score != null && row.score > CSAT_MAX_SCORE
        ? 'excluded'
        : row.recordingId
          ? 'pending'
          : 'unmatched';
    await this.csatRepo.update(id, { status, lastError: null });
    return { ok: true };
  }
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normaliseDecision(v: unknown): string | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (s === 'contest' || s === 'do_not_contest' || s === 'unclear') return s;
  if (s.includes('do not') || s.includes('do_not')) return 'do_not_contest';
  if (s === 'contest') return 'contest';
  return s ? 'unclear' : null;
}
