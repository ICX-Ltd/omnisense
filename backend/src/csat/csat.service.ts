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
import { BatchJob } from '../db/entities/batch-job.entity';
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
    @InjectRepository(BatchJob)
    private readonly batchJobRepo: Repository<BatchJob>,
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

  // ─── Date range ────────────────────────────────────────────────────────────
  // The page is a weekly task, so board + list are both scoped to a date range.
  // We anchor on COALESCE(respondedAt, createdAt) — the same expression the
  // monthly decision trend already groups by — so a record's date never changes
  // meaning between the tiles and the table. `to` is treated as inclusive of the
  // whole day when a bare date (yyyy-MM-dd) is supplied.
  private applyDateRange(
    qb: { andWhere: (w: string, p?: any) => any },
    alias: string,
    from?: string,
    to?: string,
  ) {
    const fromDate = parseDate(from, false);
    const toDate = parseDate(to, true);
    const col = `COALESCE(${alias}.respondedAt, ${alias}.createdAt)`;
    if (fromDate) qb.andWhere(`${col} >= :dtFrom`, { dtFrom: fromDate });
    if (toDate) qb.andWhere(`${col} <= :dtTo`, { dtTo: toDate });
  }

  // ─── Board metrics ─────────────────────────────────────────────────────────
  async board(range: { from?: string; to?: string } = {}) {
    // Every aggregate below is scoped to the same range.
    const scoped = () => {
      const qb = this.csatRepo.createQueryBuilder('c');
      this.applyDateRange(qb, 'c', range.from, range.to);
      return qb;
    };

    const byStatus = await scoped()
      .select('c.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .groupBy('c.status')
      .getRawMany<{ status: string; count: string }>();

    const byDecision = await scoped()
      .select("COALESCE(c.decision, 'unassessed')", 'decision')
      .addSelect('COUNT(1)', 'count')
      .andWhere('c.status = :s', { s: 'assessed' })
      .groupBy("COALESCE(c.decision, 'unassessed')")
      .getRawMany<{ decision: string; count: string }>();

    const byCampaign = await scoped()
      .select("COALESCE(c.campaign, 'unknown')", 'campaign')
      .addSelect('COUNT(1)', 'total')
      .addSelect("SUM(CASE WHEN c.decision = 'contest' THEN 1 ELSE 0 END)", 'contest')
      .addSelect("SUM(CASE WHEN c.decision = 'do_not_contest' THEN 1 ELSE 0 END)", 'do_not_contest')
      .addSelect("SUM(CASE WHEN c.status = 'assessed' THEN 1 ELSE 0 END)", 'assessed')
      .groupBy("COALESCE(c.campaign, 'unknown')")
      .orderBy('total', 'DESC')
      .getRawMany<{ campaign: string; total: string; contest: string; do_not_contest: string; assessed: string }>();

    // Monthly contest / do-not-contest counts for the headline sparklines.
    const decisionTrend = await scoped()
      .select("FORMAT(COALESCE(c.respondedAt, c.createdAt), 'yyyy-MM')", 'ym')
      .addSelect("SUM(CASE WHEN c.decision = 'contest' THEN 1 ELSE 0 END)", 'contest')
      .addSelect("SUM(CASE WHEN c.decision = 'do_not_contest' THEN 1 ELSE 0 END)", 'do_not_contest')
      .andWhere("c.status = 'assessed'")
      .groupBy("FORMAT(COALESCE(c.respondedAt, c.createdAt), 'yyyy-MM')")
      .orderBy('ym', 'ASC')
      .getRawMany<{ ym: string; contest: string; do_not_contest: string }>();

    // Supervisor review outcomes. "Raise with client" (accept a contest OR
    // disagree with a do-not-contest) is the key exported metric. It then splits
    // into sent-to-client-or-not, and for the sent ones, the client's answer.
    const byReview = await scoped()
      .select("SUM(CASE WHEN c.reviewOutcome = 'raise_with_client' THEN 1 ELSE 0 END)", 'raise_with_client')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'do_not_raise' THEN 1 ELSE 0 END)", 'do_not_raise')
      .addSelect("SUM(CASE WHEN c.status = 'assessed' AND c.reviewOutcome IS NULL THEN 1 ELSE 0 END)", 'pending_review')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'raise_with_client' AND c.raisedAt IS NOT NULL THEN 1 ELSE 0 END)", 'raised')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'raise_with_client' AND c.raisedAt IS NULL THEN 1 ELSE 0 END)", 'not_raised')
      .addSelect("SUM(CASE WHEN c.raisedAt IS NOT NULL AND c.clientOutcome IS NULL THEN 1 ELSE 0 END)", 'awaiting_client')
      .addSelect("SUM(CASE WHEN c.clientOutcome = 'accepted' THEN 1 ELSE 0 END)", 'client_accepted')
      .addSelect("SUM(CASE WHEN c.clientOutcome = 'rejected' THEN 1 ELSE 0 END)", 'client_rejected')
      .getRawOne<Record<string, string>>();

    // Monthly raise-with-client / do-not-raise counts (by review date) for the
    // headline sparklines.
    const reviewTrend = await scoped()
      .select("FORMAT(c.reviewedAt, 'yyyy-MM')", 'ym')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'raise_with_client' THEN 1 ELSE 0 END)", 'raise_with_client')
      .addSelect("SUM(CASE WHEN c.reviewOutcome = 'do_not_raise' THEN 1 ELSE 0 END)", 'do_not_raise')
      .andWhere('c.reviewOutcome IS NOT NULL AND c.reviewedAt IS NOT NULL')
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
        raised: num(byReview?.raised),
        notRaised: num(byReview?.not_raised),
        awaitingClient: num(byReview?.awaiting_client),
        clientAccepted: num(byReview?.client_accepted),
        clientRejected: num(byReview?.client_rejected),
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
  async list(opts: {
    status?: string;
    decision?: string;
    campaign?: string;
    reviewOutcome?: string;
    raised?: string;
    clientOutcome?: string;
    from?: string;
    to?: string;
    limit?: number;
    /** Hide records a supervisor has already accepted or disagreed with. */
    undecidedOnly?: boolean;
  }) {
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
        'c.raisedAt AS raisedAt',
        'c.raisedBy AS raisedBy',
        'c.clientOutcome AS clientOutcome',
        'c.clientRespondedAt AS clientRespondedAt',
        'c.clientResponseBy AS clientResponseBy',
        'c.clientResponseComment AS clientResponseComment',
        'c.assessedAt AS assessedAt',
        'c.createdAt AS createdAt',
        'ia.agent AS agent',
        'ia.interactionId AS interactionId',
        'ia.interactionDateTime AS interactionDateTime',
      ])
      .orderBy('c.createdAt', 'DESC')
      .limit(Math.min(Math.max(opts.limit ?? 200, 1), 5000));

    // 'pending_any' is the union the Pending tile counts — a single status can't
    // express it, so it gets a pseudo-value (same trick as clientOutcome=awaiting).
    if (opts.status === 'pending_any') {
      qb.andWhere('c.status IN (:...pendingStatuses)', {
        pendingStatuses: ['pending', 'awaiting_transcript', 'assessing'],
      });
    } else if (opts.status) {
      qb.andWhere('c.status = :st', { st: opts.status });
    }
    if (opts.decision) qb.andWhere('c.decision = :dc', { dc: opts.decision });
    if (opts.campaign) qb.andWhere('c.campaign = :cp', { cp: opts.campaign });
    if (opts.reviewOutcome) qb.andWhere('c.reviewOutcome = :ro', { ro: opts.reviewOutcome });

    // raised=yes|no — has the record actually been sent to the client yet.
    if (opts.raised === 'yes') qb.andWhere('c.raisedAt IS NOT NULL');
    else if (opts.raised === 'no') qb.andWhere('c.raisedAt IS NULL');

    // clientOutcome=awaiting means raised but no answer back yet.
    if (opts.clientOutcome === 'awaiting') {
      qb.andWhere('c.raisedAt IS NOT NULL AND c.clientOutcome IS NULL');
    } else if (opts.clientOutcome) {
      qb.andWhere('c.clientOutcome = :co', { co: opts.clientOutcome });
    }

    // Outstanding work only: drop anything a supervisor has already actioned,
    // so a long list stays focused on what still needs a decision.
    if (opts.undecidedOnly) {
      qb.andWhere('c.reviewAction IS NULL');
    }

    this.applyDateRange(qb, 'c', opts.from, opts.to);

    return qb.getRawMany();
  }

  // ─── Raised with client (bulk or single) ───────────────────────────────────
  // Marks records as actually sent to the client. Called with the whole export
  // set from the "Raise with client" drill-down, or with a single id from the
  // record's own toolbar. raised=false un-marks (a mistaken export).
  async setRaised(ids: string[], user: string | null, raised = true) {
    const clean = (ids ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
    if (!clean.length) throw new BadRequestException('ids is required');

    await this.csatRepo
      .createQueryBuilder()
      .update(InteractionCsat)
      .set(
        raised
          ? { raisedAt: new Date(), raisedBy: (user ?? '').trim() || null }
          : { raisedAt: null, raisedBy: null },
      )
      .whereInIds(clean)
      .execute();

    return { updated: clean.length, raised };
  }

  // ─── Client response (bulk or single) ─────────────────────────────────────
  // The client either ACCEPTS the contest (the CSAT no longer stands as a fail)
  // or REJECTS it (it stands). The explanatory comment is required so the reason
  // for their decision is always on record. 'clear' wipes the response.
  async setClientResponse(
    ids: string[],
    outcome: string,
    comment: string,
    user: string | null,
  ) {
    const clean = (ids ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
    if (!clean.length) throw new BadRequestException('ids is required');

    const out = (outcome ?? '').trim().toLowerCase();
    if (out !== 'accepted' && out !== 'rejected' && out !== 'clear') {
      throw new BadRequestException(
        "outcome must be 'accepted', 'rejected' or 'clear'",
      );
    }

    const text = (comment ?? '').trim();
    if (out !== 'clear' && !text) {
      throw new BadRequestException(
        'comment is required — record the client’s reasoning',
      );
    }

    await this.csatRepo
      .createQueryBuilder()
      .update(InteractionCsat)
      .set(
        out === 'clear'
          ? {
              clientOutcome: null,
              clientRespondedAt: null,
              clientResponseBy: null,
              clientResponseComment: null,
            }
          : {
              clientOutcome: out,
              clientRespondedAt: new Date(),
              clientResponseBy: (user ?? '').trim() || null,
              clientResponseComment: text,
              // A response implies it went out, even if the raise was never
              // explicitly marked (e.g. sent outside the app).
              raisedAt: () => 'COALESCE(raisedAt, SYSDATETIME())',
            },
      )
      .whereInIds(clean)
      .execute();

    return { updated: clean.length, clientOutcome: out === 'clear' ? null : out };
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

  /**
   * Background variant of runBatch.
   *
   * runBatch loops inside the HTTP request, so a run is bounded by the proxy
   * timeout — about 25 records in practice. A bulk import produces hundreds of
   * CSATs at once, which made that a real ceiling: 400 records meant ~17 manual
   * rounds. This hands off the same work to a batch_jobs row, mirroring
   * RecordingsService.startBatchInsights, and returns immediately so the caller
   * can poll for progress.
   *
   * Still sequential per record — assessment is LLM-bound and CSAT volumes are
   * modest, so there is no need for a worker pool here.
   */
  async startBatchAssess(
    limit: number,
    provider?: InsightsProviderName,
    model?: string,
    range?: { from?: string; to?: string },
  ): Promise<{ jobId: string; total: number }> {
    const candidates = await this.findAssessCandidates(limit, range);

    const job = await this.batchJobRepo.save(
      this.batchJobRepo.create({
        type: 'csat_assess',
        status: 'running',
        total: candidates.length,
        progress: 0,
        errorCount: 0,
        provider: provider ?? null,
        completedAt: null,
      }),
    );

    setImmediate(() => {
      this.runAssessBackground(
        job.id,
        candidates.map((c) => c.id),
        provider,
        model,
      ).catch(async (err) => {
        this.logger.error(`[csat] batch assess failed: ${err?.message ?? err}`);
        await this.batchJobRepo
          .update(job.id, { status: 'failed', completedAt: new Date() })
          .catch(() => {});
      });
    });

    return { jobId: job.id, total: candidates.length };
  }

  /**
   * Candidate selection shared by the synchronous and background paths, so the
   * two cannot drift on which records they consider assessable.
   */
  private async findAssessCandidates(
    limit: number,
    range?: { from?: string; to?: string },
  ): Promise<InteractionCsat[]> {
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

    const qb = this.csatRepo
      .createQueryBuilder('c')
      .where('c.status IN (:...statuses)', {
        statuses: ['pending', 'awaiting_transcript'],
      })
      .andWhere('c.recordingId IS NOT NULL')
      .andWhere('c.score <= :max', { max: CSAT_MAX_SCORE });

    // Honour the page's date range so an assessor can work through one slice at
    // a time. Uses the SAME applyDateRange helper as the board and list — rolling
    // a separate comparison here would let a record fall inside the range you can
    // see but outside the range you can assess (or vice versa), and it would miss
    // the inclusive end-of-day handling for a bare yyyy-MM-dd.
    this.applyDateRange(qb, 'c', range?.from, range?.to);

    return qb
      .orderBy('c.createdAt', 'ASC')
      .take(Math.min(Math.max(limit, 1), 2000))
      .getMany();
  }

  private async runAssessBackground(
    jobId: string,
    ids: string[],
    provider?: InsightsProviderName,
    model?: string,
  ): Promise<void> {
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      try {
        const done = await this.assessOne(id, provider, model);
        if (done === 'error') {
          errors.push({ id, error: 'assessment returned error' });
          await this.batchJobRepo.increment({ id: jobId }, 'errorCount', 1);
        }
      } catch (e: any) {
        errors.push({ id, error: e?.message ?? String(e) });
        await this.batchJobRepo.increment({ id: jobId }, 'errorCount', 1);
        this.logger.error(`CSAT assess failed for ${id}: ${e?.message ?? e}`);
      }
      await this.batchJobRepo.increment({ id: jobId }, 'progress', 1);
    }

    await this.batchJobRepo.update(jobId, {
      status: 'completed',
      completedAt: new Date(),
      errorsJson: errors.length ? JSON.stringify(errors.slice(-50)) : null,
    });
    this.logger.log(
      `[csat] batch assess finished: ${ids.length} processed, ${errors.length} errored`,
    );
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

// Parse a filter date. A bare yyyy-MM-dd is taken as local midnight; when it is
// the range END, it stretches to 23:59:59.999 so the day is inclusive. Anything
// unparseable is ignored (no filter) rather than throwing — a half-typed date in
// the UI shouldn't error the page.
function parseDate(value: string | undefined, endOfDay: boolean): Date | null {
  const s = String(value ?? '').trim();
  if (!s) return null;

  const bareDate = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(bareDate ? `${s}T00:00:00` : s);
  if (isNaN(d.getTime())) return null;

  if (endOfDay && bareDate) d.setHours(23, 59, 59, 999);
  return d;
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
