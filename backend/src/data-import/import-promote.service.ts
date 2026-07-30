// Promotes staged rows into the live tables, and rolls them back out again.
//
// Set-based and chunked, matching the house idiom for bulk loads
// (sql/interaction_build.sql, backend/sql/nmgb_survey_load.sql). At tens of
// thousands of rows this is the difference between seconds and an hour.
//
// Every statement is idempotent. Promote only ever touches rows whose
// promoteStatus is pending/failed, and each insert carries a NOT EXISTS guard, so
// re-running after a partial failure resumes rather than duplicating.

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { BatchJob } from '../db/entities/batch-job.entity';
import { ImportRun } from '../db/entities/import-run.entity';
import { SourceMapping } from './mappings/mapping.types';
import { describeError } from '../utils/describe-error.util';

/**
 * Only CSATs at or below this score are contest-assessed; 4-5 are excluded.
 * Mirrors CSAT_MAX_SCORE in csat/csat.service.ts — keep the two in step.
 */
function csatAssessMaxScore(): number {
  return Number(process.env.CSAT_ASSESS_MAX_SCORE) || 3;
}

function promoteBatchRows(): number {
  const raw = Number(process.env.IMPORT_PROMOTE_BATCH_ROWS);
  return Number.isFinite(raw) && raw > 0 ? raw : 2000;
}

/** Statuses from which a promote may be started or resumed. */
const PROMOTABLE_RUN_STATUSES = ['staged', 'promote_failed', 'promoted'];

export interface PromotePreview {
  runId: string;
  promotable: number;
  alreadyPromoted: number;
  excluded: number;
  /** Rows that would be skipped because the interaction already exists. */
  wouldSkipExisting: number;
  withCsat: number;
  withSurvey: number;
  withTranscript: number;
}

export interface RollbackPreview {
  runId: string;
  promotedInteractions: number;
  /** Insight rows that would be destroyed — real LLM spend. */
  insightsAffected: number;
  transcriptsAffected: number;
  /** CSAT rows this import created; these are deleted. */
  csatCreatedByImport: number;
  /** CSAT rows that pre-existed; these are unlinked, not deleted. */
  csatPreExisting: number;
  surveysAffected: number;
}

@Injectable()
export class ImportPromoteService {
  private readonly logger = new Logger(ImportPromoteService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ImportRun)
    private readonly runsRepo: Repository<ImportRun>,
    @InjectRepository(BatchJob)
    private readonly jobRepo: Repository<BatchJob>,
  ) {}

  // ─── preview ───────────────────────────────────────────────────────────────

  /** What a promote would do. Writes nothing. */
  async previewPromote(runId: string): Promise<PromotePreview> {
    const rows = await this.ds.query(
      `SELECT
         SUM(CASE WHEN ${this.promotablePredicate()} THEN 1 ELSE 0 END) AS promotable,
         SUM(CASE WHEN promoteStatus = 'promoted' THEN 1 ELSE 0 END)    AS alreadyPromoted,
         SUM(CASE WHEN excluded = 1 THEN 1 ELSE 0 END)                  AS excluded,
         SUM(CASE WHEN ${this.promotablePredicate()} AND csatScore IS NOT NULL THEN 1 ELSE 0 END) AS withCsat,
         SUM(CASE WHEN ${this.promotablePredicate()} AND surveyAnswersJson IS NOT NULL THEN 1 ELSE 0 END) AS withSurvey,
         SUM(CASE WHEN ${this.promotablePredicate()} AND transcriptJson IS NOT NULL THEN 1 ELSE 0 END) AS withTranscript
       FROM app.import_conversations WHERE importRunId = @0`,
      [runId],
    );

    // Counted separately: needs a correlated EXISTS against the live table.
    const existing = await this.ds.query(
      `SELECT COUNT(*) AS n
         FROM app.import_conversations c
        WHERE c.importRunId = @0
          AND ${this.promotablePredicate('c')}
          AND EXISTS (SELECT 1 FROM app.interactions i
                       WHERE i.interactionSource = c.sourceKey
                         AND i.interactionId = c.interactionId)`,
      [runId],
    );

    const r = rows?.[0] ?? {};
    return {
      runId,
      promotable: Number(r.promotable ?? 0),
      alreadyPromoted: Number(r.alreadyPromoted ?? 0),
      excluded: Number(r.excluded ?? 0),
      wouldSkipExisting: Number(existing?.[0]?.n ?? 0),
      withCsat: Number(r.withCsat ?? 0),
      withSurvey: Number(r.withSurvey ?? 0),
      withTranscript: Number(r.withTranscript ?? 0),
    };
  }

  /**
   * The gate for promotion. A row must be un-excluded, not already promoted, and
   * carry no validation errors.
   */
  private promotablePredicate(alias = ''): string {
    const p = alias ? `${alias}.` : '';
    return (
      `${p}excluded = 0 AND ${p}promoteStatus IN ('pending','failed') ` +
      `AND ${p}validationStatus IN ('valid','warning')`
    );
  }

  // ─── promote ───────────────────────────────────────────────────────────────

  /**
   * Starts a background promote. Returns as soon as the work is scheduled.
   */
  async startPromote(
    runId: string,
    mapping: SourceMapping,
  ): Promise<{ jobId: string; total: number }> {
    const run = await this.runsRepo.findOne({ where: { id: runId } });
    if (!run) throw new BadRequestException(`No import run ${runId}`);
    if (!PROMOTABLE_RUN_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        `Run is "${run.status}"; only ${PROMOTABLE_RUN_STATUSES.join(', ')} can be promoted.`,
      );
    }

    const preview = await this.previewPromote(runId);
    if (preview.promotable === 0) {
      throw new BadRequestException(
        'No rows are ready to promote. Every staged row is excluded, already ' +
          'promoted, or has validation errors.',
      );
    }

    const job = await this.jobRepo.save(
      this.jobRepo.create({
        type: 'import_promote',
        status: 'running',
        // Unlike a streaming parse, the total is known up front here.
        total: preview.promotable,
        progress: 0,
        errorCount: 0,
        provider: run.sourceKey,
        completedAt: null,
      }),
    );

    await this.runsRepo.update(runId, {
      status: 'promoting',
      promoteJobId: job.id,
      lastError: null,
    });

    setImmediate(() => {
      this.runPromoteBackground(runId, job.id, mapping).catch(async (err) => {
        this.logger.error(
          `[import] promote failed for run ${runId}: ${describeError(err)}`,
        );
        await this.runsRepo
          .update(runId, {
            status: 'promote_failed',
            lastError: describeError(err).slice(0, 2000),
          })
          .catch(() => {});
        await this.jobRepo
          .update(job.id, { status: 'failed', completedAt: new Date() })
          .catch(() => {});
      });
    });

    return { jobId: job.id, total: preview.promotable };
  }

  private async runPromoteBackground(
    runId: string,
    jobId: string,
    mapping: SourceMapping,
  ): Promise<void> {
    const batchSize = promoteBatchRows();
    const maxScore = csatAssessMaxScore();
    let totals = {
      interactions: 0,
      transcripts: 0,
      csat: 0,
      surveys: 0,
      skipped: 0,
    };

    for (;;) {
      const claimed = await this.promoteChunk(runId, mapping, maxScore, batchSize);
      if (claimed.claimed === 0) break;

      totals = {
        interactions: totals.interactions + claimed.interactions,
        transcripts: totals.transcripts + claimed.transcripts,
        csat: totals.csat + claimed.csat,
        surveys: totals.surveys + claimed.surveys,
        skipped: totals.skipped + claimed.skipped,
      };
      await this.jobRepo.increment({ id: jobId }, 'progress', claimed.claimed);
    }

    await this.runsRepo.update(runId, {
      status: 'promoted',
      promotedAt: new Date(),
      promotedInteractions: totals.interactions,
      promotedTranscripts: totals.transcripts,
      promotedCsat: totals.csat,
      promotedSurveys: totals.surveys,
      promoteSkipped: totals.skipped,
    });
    await this.jobRepo.update(jobId, {
      status: 'completed',
      completedAt: new Date(),
    });

    this.logger.log(
      `[import] run ${runId} promoted: ${totals.interactions} interactions, ` +
        `${totals.transcripts} transcripts, ${totals.csat} CSAT, ` +
        `${totals.surveys} surveys` +
        (totals.skipped ? `, ${totals.skipped} skipped as already present` : ''),
    );
  }

  /**
   * Promotes one chunk inside a single transaction.
   *
   * Chunk-per-transaction rather than one transaction for the whole run: a
   * 200k-row transaction would blow the log and escalate locks. A failure part
   * way through leaves earlier chunks committed and the run resumable, which is
   * what the promoteStatus bookkeeping is for.
   */
  private async promoteChunk(
    runId: string,
    mapping: SourceMapping,
    maxScore: number,
    batchSize: number,
  ): Promise<{
    claimed: number;
    interactions: number;
    transcripts: number;
    csat: number;
    surveys: number;
    skipped: number;
  }> {
    return this.ds.transaction(async (em) => {
      // ── Step 0: claim a chunk and pre-generate the interaction ids ─────────
      // Claiming up front means child inserts can join on the id without a round
      // trip, and a re-run cannot double-promote a claimed row.
      const claimResult = await em.query(
        `UPDATE TOP (${batchSize}) app.import_conversations
            SET promotedInteractionId = NEWID()
          WHERE importRunId = @0
            AND ${this.promotablePredicate()}
            AND promotedInteractionId IS NULL;
         SELECT @@ROWCOUNT AS claimed;`,
        [runId],
      );
      const claimed = Number(claimResult?.[0]?.claimed ?? 0);
      if (claimed === 0) {
        return {
          claimed: 0,
          interactions: 0,
          transcripts: 0,
          csat: 0,
          surveys: 0,
          skipped: 0,
        };
      }

      const defaults = mapping.interactionDefaults;

      // ── Step 1: app.interactions ──────────────────────────────────────────
      // effectiveDate is a PERSISTED COMPUTED column and is never listed.
      // daysToMaturityAtInteraction stays NULL: chats have no maturity date, and
      // raw SQL bypasses the entity's @BeforeInsert hook, which is intended.
      // status/interactionType are load-bearing — startBatchInsightsChats selects
      // status IN ('transcribed') AND interactionType = 'chat'.
      const ins = await em.query(
        `INSERT INTO app.interactions
           (id, provider, status, createdAt, updatedAt, interactionSource,
            interactionType, interactionId, interactionTpsId, campaign, agent,
            interactionDateTime, outcome, dealer, vehicleMake, vehicleModel, hasCsat)
         SELECT c.promotedInteractionId, @1, @2, SYSUTCDATETIME(), SYSUTCDATETIME(),
                c.sourceKey, @3, c.interactionId, c.interactionTpsId, c.campaign,
                c.agent, c.interactionDateTime, c.outcome, c.dealer,
                c.vehicleMake, c.vehicleModel,
                CASE WHEN c.csatScore IS NOT NULL THEN 1 ELSE NULL END
           FROM app.import_conversations c
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND NOT EXISTS (SELECT 1 FROM app.interactions i
                             WHERE i.interactionSource = c.sourceKey
                               AND i.interactionId = c.interactionId);
         SELECT @@ROWCOUNT AS n;`,
        [runId, defaults.provider, defaults.status, defaults.interactionType],
      );

      // ── Step 2: app.interaction_transcripts ───────────────────────────────
      // Explicit NOT EXISTS: the index on recordingId is NOT unique, despite
      // upsert(['recordingId']) being used elsewhere in the codebase.
      // model is honest — no transcription happened. Nothing filters on it.
      const tr = await em.query(
        `INSERT INTO app.interaction_transcripts
           (recordingId, text, model, wordCount, createdAt)
         SELECT c.promotedInteractionId, c.transcriptJson, @1,
                c.transcriptMessageCount, SYSUTCDATETIME()
           FROM app.import_conversations c
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND c.transcriptJson IS NOT NULL
            AND EXISTS (SELECT 1 FROM app.interactions i
                         WHERE i.id = c.promotedInteractionId)
            AND NOT EXISTS (SELECT 1 FROM app.interaction_transcripts t
                             WHERE t.recordingId = c.promotedInteractionId);
         SELECT @@ROWCOUNT AS n;`,
        [runId, `${mapping.key}-import`],
      );

      // ── Step 3a: link CSAT rows that already exist ────────────────────────
      // interaction_csat.interactionTpsId is UNIQUE, so an insert would collide.
      // A CSAT can legitimately arrive before its interaction (status
      // 'unmatched'), which is exactly what this links up. Mirrors the semantics
      // of CsatService.ingest: preserve an existing assessment, exclude 4-5.
      await em.query(
        `UPDATE cs
            SET recordingId = c.promotedInteractionId,
                campaign    = COALESCE(cs.campaign, c.campaign),
                score       = COALESCE(cs.score, c.csatScore),
                scoreMax    = COALESCE(cs.scoreMax, c.csatScoreMax),
                comment     = COALESCE(cs.comment, c.csatComment),
                respondedAt = COALESCE(cs.respondedAt, c.csatRespondedAt),
                status = CASE
                  WHEN cs.status = 'assessed' THEN 'assessed'
                  WHEN COALESCE(cs.score, c.csatScore) > @1 THEN 'excluded'
                  ELSE 'pending' END
           FROM app.interaction_csat cs
           JOIN app.import_conversations c
             ON c.interactionTpsId = cs.interactionTpsId
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND c.csatScore IS NOT NULL
            AND EXISTS (SELECT 1 FROM app.interactions i
                         WHERE i.id = c.promotedInteractionId)`,
        [runId, maxScore],
      );

      // ── Step 3b: insert the CSAT rows this import owns ─────────────────────
      // _importRunId in rawFeedJson is what lets rollback tell rows it created
      // from rows that pre-existed. JSON-as-source-of-truth: no new column.
      const cs = await em.query(
        `INSERT INTO app.interaction_csat
           (interactionTpsId, recordingId, campaign, score, scoreMax, comment,
            respondedAt, rawFeedJson, status)
         SELECT c.interactionTpsId, c.promotedInteractionId, c.campaign,
                c.csatScore, c.csatScoreMax, c.csatComment, c.csatRespondedAt,
                (SELECT c.importRunId AS [_importRunId],
                        @2             AS [_source],
                        c.mcs          AS [mcs],
                        c.alertedMcs   AS [alertedMcs],
                        c.surveyType   AS [surveyType]
                   FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                CASE WHEN c.csatScore > @1 THEN 'excluded' ELSE 'pending' END
           FROM app.import_conversations c
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND c.csatScore IS NOT NULL
            AND c.interactionTpsId IS NOT NULL
            AND EXISTS (SELECT 1 FROM app.interactions i
                         WHERE i.id = c.promotedInteractionId)
            AND NOT EXISTS (SELECT 1 FROM app.interaction_csat x
                             WHERE x.interactionTpsId = c.interactionTpsId);
         SELECT @@ROWCOUNT AS n;`,
        [runId, maxScore, mapping.key],
      );

      // ── Step 4: hasCsat mop-up ────────────────────────────────────────────
      // Covers interactions whose CSAT pre-existed the import, where step 1's
      // CASE saw no staged csatScore.
      await em.query(
        `UPDATE i SET hasCsat = 1
           FROM app.interactions i
           JOIN app.import_conversations c ON c.promotedInteractionId = i.id
           JOIN app.interaction_csat cs ON cs.recordingId = i.id
          WHERE c.importRunId = @0 AND ISNULL(i.hasCsat, 0) = 0`,
        [runId],
      );

      // ── Step 5: app.interaction_survey ────────────────────────────────────
      // The table already exists for exactly this shape and the LLM never writes
      // it, which was the point of splitting it out.
      const sv = await em.query(
        `INSERT INTO app.interaction_survey
           (recordingId, interactionTpsId, campaign, surveyType, answersJson, respondedAt)
         SELECT c.promotedInteractionId, c.interactionTpsId, c.campaign, @1,
                c.surveyAnswersJson, c.csatRespondedAt
           FROM app.import_conversations c
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND c.surveyAnswersJson IS NOT NULL
            AND EXISTS (SELECT 1 FROM app.interactions i
                         WHERE i.id = c.promotedInteractionId)
            AND NOT EXISTS (SELECT 1 FROM app.interaction_survey s
                             WHERE s.recordingId = c.promotedInteractionId
                               AND s.surveyType = @1);
         SELECT @@ROWCOUNT AS n;`,
        [runId, mapping.survey.type],
      );

      // ── Step 6: settle the staging rows ───────────────────────────────────
      await em.query(
        `UPDATE c SET promoteStatus = 'promoted', promoteError = NULL
           FROM app.import_conversations c
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND EXISTS (SELECT 1 FROM app.interactions i
                         WHERE i.id = c.promotedInteractionId)`,
        [runId],
      );

      // Claimed but no interaction exists => the NOT EXISTS guard fired because
      // this source key was already live. Release the claimed id so the row is
      // not mistaken for promoted, and record why.
      //
      // Counted with a SELECT before the UPDATE for the same reason as rollback:
      // `UPDATE <alias> FROM ...; SELECT @@ROWCOUNT` does not put the SELECT in
      // the recordset TypeORM hands back, so the count silently reads 0.
      const skCount = await em.query(
        `SELECT COUNT(*) AS n
           FROM app.import_conversations c
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND NOT EXISTS (SELECT 1 FROM app.interactions i
                             WHERE i.id = c.promotedInteractionId)`,
        [runId],
      );
      await em.query(
        `UPDATE c
            SET promoteStatus = 'skipped',
                promotedInteractionId = NULL,
                promoteError = 'An interaction with this source key already existed'
           FROM app.import_conversations c
          WHERE c.importRunId = @0
            AND c.promotedInteractionId IS NOT NULL
            AND c.promoteStatus IN ('pending','failed')
            AND NOT EXISTS (SELECT 1 FROM app.interactions i
                             WHERE i.id = c.promotedInteractionId)`,
        [runId],
      );

      return {
        claimed,
        interactions: Number(ins?.[0]?.n ?? 0),
        transcripts: Number(tr?.[0]?.n ?? 0),
        csat: Number(cs?.[0]?.n ?? 0),
        surveys: Number(sv?.[0]?.n ?? 0),
        skipped: Number(skCount?.[0]?.n ?? 0),
      };
    });
  }

  // ─── rollback ──────────────────────────────────────────────────────────────

  /** What a rollback would destroy. Writes nothing. */
  async previewRollback(runId: string): Promise<RollbackPreview> {
    const r = await this.ds.query(
      `SELECT
         (SELECT COUNT(*) FROM app.import_conversations
           WHERE importRunId = @0 AND promoteStatus = 'promoted') AS promotedInteractions,
         (SELECT COUNT(*) FROM app.interaction_insights x
            JOIN app.import_conversations c ON c.promotedInteractionId = x.recordingId
           WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted') AS insightsAffected,
         (SELECT COUNT(*) FROM app.interaction_transcripts t
            JOIN app.import_conversations c ON c.promotedInteractionId = t.recordingId
           WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted') AS transcriptsAffected,
         (SELECT COUNT(*) FROM app.interaction_csat cs
            JOIN app.import_conversations c ON c.promotedInteractionId = cs.recordingId
           WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'
             AND JSON_VALUE(cs.rawFeedJson, '$._importRunId') = CAST(@0 AS varchar(36))
          ) AS csatCreatedByImport,
         (SELECT COUNT(*) FROM app.interaction_csat cs
            JOIN app.import_conversations c ON c.promotedInteractionId = cs.recordingId
           WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'
             AND (cs.rawFeedJson IS NULL
                  OR ISNULL(JSON_VALUE(cs.rawFeedJson, '$._importRunId'), '') <> CAST(@0 AS varchar(36)))
          ) AS csatPreExisting,
         (SELECT COUNT(*) FROM app.interaction_survey s
            JOIN app.import_conversations c ON c.promotedInteractionId = s.recordingId
           WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted') AS surveysAffected`,
      [runId],
    );
    const x = r?.[0] ?? {};
    return {
      runId,
      promotedInteractions: Number(x.promotedInteractions ?? 0),
      insightsAffected: Number(x.insightsAffected ?? 0),
      transcriptsAffected: Number(x.transcriptsAffected ?? 0),
      csatCreatedByImport: Number(x.csatCreatedByImport ?? 0),
      csatPreExisting: Number(x.csatPreExisting ?? 0),
      surveysAffected: Number(x.surveysAffected ?? 0),
    };
  }

  /**
   * Removes everything a promote created, returning the run to 'staged' so it can
   * be corrected and promoted again.
   *
   * Order matters. interaction_csat and interaction_survey have NO foreign key to
   * interactions, so they must be handled explicitly and FIRST; deleting the
   * interactions would otherwise orphan them. interaction_transcripts and
   * interaction_insights DO cascade.
   *
   * CSAT rows this import created are deleted; rows that pre-existed are UNLINKED
   * back to 'unmatched' rather than destroyed — they belong to the CSAT feed, not
   * to us.
   */
  async rollback(
    runId: string,
    mapping: SourceMapping,
  ): Promise<{
    interactionsDeleted: number;
    csatDeleted: number;
    csatUnlinked: number;
    surveysDeleted: number;
  }> {
    const run = await this.runsRepo.findOne({ where: { id: runId } });
    if (!run) throw new BadRequestException(`No import run ${runId}`);
    if (run.status === 'promoting') {
      throw new BadRequestException(
        'This run is mid-promote. Wait for it to finish before rolling back.',
      );
    }

    const before = await this.previewRollback(runId);
    if (before.promotedInteractions === 0) {
      throw new BadRequestException(
        'Nothing to roll back — this run has no promoted rows.',
      );
    }

    const result = await this.ds.transaction(async (em) => {
      // Counts are taken BEFORE the deletes, with the same predicates, inside the
      // same transaction — so they describe exactly what is about to be removed.
      //
      // Not `DELETE ...; SELECT @@ROWCOUNT`: TypeORM's query() exposes only the
      // first recordset, and for `DELETE <alias> FROM ...` that is not the
      // SELECT, so every count came back 0 after a rollback that had in fact
      // deleted everything. Reporting "0 deleted" after a successful destructive
      // operation is worse than the operation being slow.
      const counts = await em.query(
        `SELECT
           (SELECT COUNT(*) FROM app.interaction_survey s
              JOIN app.import_conversations c ON c.promotedInteractionId = s.recordingId
             WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'
               AND s.surveyType = @1) AS surveysDeleted,
           (SELECT COUNT(*) FROM app.interaction_csat cs
              JOIN app.import_conversations c ON c.promotedInteractionId = cs.recordingId
             WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'
               AND JSON_VALUE(cs.rawFeedJson, '$._importRunId') = CAST(@0 AS varchar(36))) AS csatDeleted,
           (SELECT COUNT(*) FROM app.interaction_csat cs
              JOIN app.import_conversations c ON c.promotedInteractionId = cs.recordingId
             WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'
               AND (cs.rawFeedJson IS NULL
                    OR ISNULL(JSON_VALUE(cs.rawFeedJson, '$._importRunId'), '') <> CAST(@0 AS varchar(36)))) AS csatUnlinked,
           (SELECT COUNT(*) FROM app.interactions i
              JOIN app.import_conversations c ON c.promotedInteractionId = i.id
             WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted') AS interactionsDeleted`,
        [runId, mapping.survey.type],
      );
      const n = counts?.[0] ?? {};

      // 1. Survey rows this importer created (no FK, so no cascade).
      await em.query(
        `DELETE s
           FROM app.interaction_survey s
           JOIN app.import_conversations c ON c.promotedInteractionId = s.recordingId
          WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'
            AND s.surveyType = @1`,
        [runId, mapping.survey.type],
      );

      // 2a. CSAT rows this import created — identified by the stamp in rawFeedJson.
      await em.query(
        `DELETE cs
           FROM app.interaction_csat cs
           JOIN app.import_conversations c ON c.promotedInteractionId = cs.recordingId
          WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'
            AND JSON_VALUE(cs.rawFeedJson, '$._importRunId') = CAST(@0 AS varchar(36))`,
        [runId],
      );

      // 2b. CSAT rows that pre-existed: unlink, do NOT delete. They came from the
      // CSAT feed and must survive for a later rematch.
      await em.query(
        `UPDATE cs SET recordingId = NULL, status = 'unmatched'
           FROM app.interaction_csat cs
           JOIN app.import_conversations c ON c.promotedInteractionId = cs.recordingId
          WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'`,
        [runId],
      );

      // 3. Interactions. FK cascade removes interaction_transcripts and
      //    interaction_insights.
      await em.query(
        `DELETE i
           FROM app.interactions i
           JOIN app.import_conversations c ON c.promotedInteractionId = i.id
          WHERE c.importRunId = @0 AND c.promoteStatus = 'promoted'`,
        [runId],
      );

      // 4. Return the staging rows to pending so the run can be promoted again.
      await em.query(
        `UPDATE app.import_conversations
            SET promoteStatus = 'pending',
                promotedInteractionId = NULL,
                promoteError = NULL
          WHERE importRunId = @0`,
        [runId],
      );

      return {
        interactionsDeleted: Number(n.interactionsDeleted ?? 0),
        csatDeleted: Number(n.csatDeleted ?? 0),
        csatUnlinked: Number(n.csatUnlinked ?? 0),
        surveysDeleted: Number(n.surveysDeleted ?? 0),
      };
    });

    await this.runsRepo.update(runId, {
      status: 'staged',
      rolledBackAt: new Date(),
      promotedAt: null,
      promotedInteractions: 0,
      promotedTranscripts: 0,
      promotedCsat: 0,
      promotedSurveys: 0,
      promoteSkipped: 0,
    });

    this.logger.warn(
      `[import] run ${runId} rolled back: ${result.interactionsDeleted} interactions ` +
        `deleted, ${result.csatDeleted} CSAT deleted, ${result.csatUnlinked} CSAT ` +
        `unlinked, ${result.surveysDeleted} surveys deleted`,
    );
    return result;
  }

  // ─── dedupe report ─────────────────────────────────────────────────────────

  /**
   * Source keys that appear more than once in app.interactions.
   *
   * Read-only. This must come back empty before the filtered unique index in
   * add-interactions-source-key-unique.sql can be created — and existing
   * maxcontact rows may legitimately collide, which is why that migration is
   * opt-in rather than part of the main one.
   */
  async dedupeReport(limit = 200): Promise<
    Array<{
      interactionSource: string;
      interactionId: string;
      count: number;
      firstSeen: string | null;
    }>
  > {
    const rows = await this.ds.query(
      `SELECT TOP (${Math.min(Math.max(limit, 1), 1000)})
              interactionSource, interactionId,
              COUNT(*) AS n, MIN(createdAt) AS firstSeen
         FROM app.interactions
        WHERE interactionSource IS NOT NULL AND interactionId IS NOT NULL
        GROUP BY interactionSource, interactionId
       HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC`,
    );
    return (rows ?? []).map(
      (r: {
        interactionSource: string;
        interactionId: string;
        n: number;
        firstSeen: Date | null;
      }) => ({
        interactionSource: r.interactionSource,
        interactionId: r.interactionId,
        count: Number(r.n),
        firstSeen: r.firstSeen ? new Date(r.firstSeen).toISOString() : null,
      }),
    );
  }
}
