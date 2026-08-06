// Streams a source file into the staging tables, then runs the set-based
// validation passes that need the whole run in view.
//
// Job pattern mirrors RecordingsService.startBatchTranscribe: insert the job
// row, hand off with setImmediate, report progress by incrementing the row. The
// difference is that a streaming parse does not know its total up front, so
// `total` is written at the end and the UI shows a row counter rather than a
// percentage bar.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { BatchJob } from '../db/entities/batch-job.entity';
import { ImportConversation } from '../db/entities/import-conversation.entity';
import { ImportMessage } from '../db/entities/import-message.entity';
import { ImportRun } from '../db/entities/import-run.entity';
import { SourceMapping } from './mappings/mapping.types';
import { ReaderPlan, iterateRows, planRead } from './helpers/delimited-reader';
import {
  StagedRow,
  resolveNaturalKeyColumn,
  stageRow,
} from './helpers/validate-row';
import { deleteQuietly, fileSize, hashFile } from './helpers/file-source';
import { describeError } from '../utils/describe-error.util';

/**
 * MSSQL caps a single statement at 2100 parameters, and TypeORM emits one
 * multi-row INSERT per chunk — so rows-per-chunk must be derived from the real
 * column count, read from entity metadata at runtime.
 *
 * This was originally a hardcoded guess (46 columns), which was wrong:
 * import_conversations has 52, so the resulting 43-row chunks would have emitted
 * ~2150 parameters and failed on the first insert. Reading the metadata means
 * adding a column can never silently reintroduce that.
 *
 * The budget leaves headroom below 2100 for the parameters TypeORM adds itself.
 */
const PARAM_BUDGET = 2000;

function chunkSizeFor(columnCount: number): number {
  return Math.max(1, Math.floor(PARAM_BUDGET / Math.max(columnCount, 1)));
}

export interface StartParseArgs {
  sourceKey: string;
  mapping: SourceMapping;
  filePath: string;
  displayName: string;
  intake: 'upload' | 'server';
  /** Path recorded on the run; only meaningful for server-inbox intake. */
  serverPath?: string | null;
  /** Stamped onto every interaction this run promotes — see import-promote.service.ts. */
  clientId?: string | null;
  naturalKeyColumnOverride?: string;
  createdBy?: string | null;
  /**
   * True for browser uploads: the temp file is the importer's to clean up once
   * the parse finishes. False for inbox files, which belong to the operator and
   * must never be moved or deleted.
   */
  deleteFileWhenDone?: boolean;
}

@Injectable()
export class ImportParseService implements OnModuleInit {
  private readonly logger = new Logger(ImportParseService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ImportRun)
    private readonly runsRepo: Repository<ImportRun>,
    @InjectRepository(ImportConversation)
    private readonly convRepo: Repository<ImportConversation>,
    @InjectRepository(ImportMessage)
    private readonly msgRepo: Repository<ImportMessage>,
    @InjectRepository(BatchJob)
    private readonly jobRepo: Repository<BatchJob>,
  ) {}

  /**
   * Reconciles runs left mid-flight by a restart.
   *
   * The batch-job machinery is in-process only, so an app-pool recycle during a
   * parse otherwise leaves a run stuck in 'parsing' for ever with no way to
   * discard or retry it from the UI.
   */
  async onModuleInit(): Promise<void> {
    try {
      const result = await this.ds.query(
        `UPDATE app.import_runs
            SET status = CASE status WHEN 'parsing' THEN 'parse_failed'
                                     ELSE 'promote_failed' END,
                lastError = 'Interrupted by a service restart'
          WHERE status IN ('parsing', 'promoting');
         SELECT @@ROWCOUNT AS affected;`,
      );
      const affected = Number(result?.[0]?.affected ?? 0);
      if (affected > 0) {
        this.logger.warn(
          `[import] marked ${affected} interrupted run(s) as failed after restart`,
        );
      }
    } catch (e) {
      // A missing table simply means add-data-import.sql has not been run yet;
      // the health drift check reports that properly.
      this.logger.warn(`[import] startup reconcile skipped: ${describeError(e)}`);
    }
  }

  /**
   * Creates the run + job rows and kicks off the background parse.
   * Returns as soon as the work is scheduled.
   */
  async startParse(args: StartParseArgs): Promise<{
    runId: string;
    jobId: string;
    fileSizeBytes: number | null;
    duplicateOfRunId: string | null;
  }> {
    // Sniff before creating anything: a wrong-shaped file should fail loudly
    // here rather than leaving an empty failed run behind.
    const plan = await planRead(args.filePath, args.mapping);

    let sizeBytes: number | null = null;
    let sha: string | null = null;
    try {
      sizeBytes = await fileSize(args.filePath);
      sha = await hashFile(args.filePath);
    } catch {
      // Informational only — never block an import over it.
    }

    // Warn rather than block: re-importing the same file is legitimate after a
    // rollback, and the operator is better placed to judge.
    let duplicateOfRunId: string | null = null;
    if (sha) {
      const prior = await this.runsRepo.findOne({
        where: { fileSha256: sha },
        order: { createdAt: 'DESC' },
      });
      duplicateOfRunId = prior?.id ?? null;
    }

    const naturalKeyColumn =
      args.naturalKeyColumnOverride ??
      resolveNaturalKeyColumn(plan.headers, args.mapping);

    const run = await this.runsRepo.save(
      this.runsRepo.create({
        sourceKey: args.sourceKey,
        mappingVersion: args.mapping.version,
        intake: args.intake,
        originalFilename: args.displayName,
        serverPath: args.serverPath ?? null,
        fileSizeBytes: sizeBytes,
        fileSha256: sha,
        delimiter: plan.delimiter,
        encoding: plan.encoding,
        headerJson: JSON.stringify(plan.headers),
        naturalKeyColumn,
        status: 'parsing',
        createdBy: args.createdBy ?? null,
        clientId: args.clientId ?? null,
      }),
    );

    const job = await this.jobRepo.save(
      this.jobRepo.create({
        type: 'import_parse',
        status: 'running',
        // Unknown while streaming; set to rowsRead when the stream ends.
        total: 0,
        progress: 0,
        errorCount: 0,
        provider: args.sourceKey,
        completedAt: null,
      }),
    );
    await this.runsRepo.update(run.id, { parseJobId: job.id });

    setImmediate(() => {
      this.runParseBackground(run.id, job.id, plan, args.mapping, naturalKeyColumn)
        .catch(async (err) => {
          this.logger.error(
            `[import] parse failed for run ${run.id}: ${describeError(err)}`,
          );
          await this.failRun(run.id, job.id, describeError(err));
        })
        .finally(async () => {
          // Only ever an upload temp file — inbox files belong to the operator.
          if (args.deleteFileWhenDone) await deleteQuietly(args.filePath);
        });
    });

    return {
      runId: run.id,
      jobId: job.id,
      fileSizeBytes: sizeBytes,
      duplicateOfRunId,
    };
  }

  private async failRun(runId: string, jobId: string, message: string) {
    await this.runsRepo
      .update(runId, { status: 'parse_failed', lastError: message.slice(0, 2000) })
      .catch(() => {});
    await this.jobRepo
      .update(jobId, { status: 'failed', completedAt: new Date() })
      .catch(() => {});
  }

  /**
   * Streams the file into staging.
   *
   * Deliberately NOT wrapped in a single transaction: a 200k-row transaction
   * would blow the log and escalate locks. Atomicity is business-level instead —
   * a failed parse leaves the run in 'parse_failed', and Discard deletes it in
   * one statement (the FK cascade cleans up conversations and messages).
   */
  private async runParseBackground(
    runId: string,
    jobId: string,
    plan: ReaderPlan,
    mapping: SourceMapping,
    naturalKeyColumn: string | null,
  ): Promise<void> {
    const skipped: Array<{ rowNumber: number | null; message: string }> = [];
    let rowsRead = 0;
    let rowsStaged = 0;
    let messagesStaged = 0;
    const statusCounts: Record<string, number> = {};
    const transcriptCounts: Record<string, number> = {};

    let convBuffer: Array<Partial<ImportConversation>> = [];
    let msgBuffer: Array<Partial<ImportMessage>> = [];

    // Derived from live entity metadata, not a constant that can drift out of
    // step with the schema.
    const convChunk = chunkSizeFor(this.convRepo.metadata.columns.length);
    const msgChunk = chunkSizeFor(this.msgRepo.metadata.columns.length);

    const flush = async () => {
      if (convBuffer.length) {
        for (let i = 0; i < convBuffer.length; i += convChunk) {
          await this.convRepo.insert(convBuffer.slice(i, i + convChunk));
        }
      }
      if (msgBuffer.length) {
        for (let i = 0; i < msgBuffer.length; i += msgChunk) {
          await this.msgRepo.insert(msgBuffer.slice(i, i + msgChunk));
        }
      }
      const staged = convBuffer.length;
      convBuffer = [];
      msgBuffer = [];
      if (staged) {
        await this.jobRepo.increment({ id: jobId }, 'progress', staged);
      }
    };

    const bufferLimit = Math.max(
      1,
      Number(process.env.IMPORT_STAGE_CHUNK_ROWS ?? 200) || 200,
    );

    for await (const { row, rowNumber, fieldCount } of iterateRows(plan, {
      onSkip: (s) => skipped.push(s),
    })) {
      rowsRead++;
      const staged = stageRow({
        row,
        headers: plan.headers,
        rowNumber,
        mapping,
        naturalKeyColumn,
        fieldCount,
      });

      statusCounts[staged.validationStatus] =
        (statusCounts[staged.validationStatus] ?? 0) + 1;
      transcriptCounts[staged.transcript.status] =
        (transcriptCounts[staged.transcript.status] ?? 0) + 1;

      // The conversation id is generated here rather than by the DB default so
      // the child message rows can reference it without a round trip.
      const conversationStageId = randomUUID();
      convBuffer.push(this.toConversationRow(conversationStageId, runId, staged, mapping));
      for (const m of staged.transcript.messages) {
        msgBuffer.push({
          importRunId: runId,
          conversationStageId,
          rowNumber: staged.rowNumber,
          seq: m.seq,
          source: m.source,
          sender: m.sender ? m.sender.slice(0, 200) : null,
          timestampText: m.timestampText,
          timestampIso: m.timestampIso,
          dayOffset: m.dayOffset,
          content: m.content,
          charCount: m.content.length,
          isAuto: m.isAuto,
          isHandover: m.isHandover,
          includedInTranscript: m.includedInTranscript,
          parseWarning: m.parseWarning ? m.parseWarning.slice(0, 200) : null,
        });
      }
      rowsStaged++;
      messagesStaged += staged.transcript.messages.length;

      if (convBuffer.length >= bufferLimit) await flush();
    }
    await flush();

    await this.runsRepo.update(runId, {
      rowsRead,
      rowsStaged,
      rowsSkipped: skipped.length,
      messagesStaged,
      transcriptsParsed: transcriptCounts.parsed ?? 0,
      transcriptsPartial: transcriptCounts.partial ?? 0,
      transcriptsFailed:
        (transcriptCounts.unparsed ?? 0) + (transcriptCounts.empty ?? 0),
    });

    // Now that the whole run is staged, the cross-row checks can run.
    await this.runValidationPasses(runId);
    await this.refreshRunCounts(runId);

    await this.runsRepo.update(runId, { status: 'staged', stagedAt: new Date() });
    await this.jobRepo.update(jobId, {
      status: 'completed',
      completedAt: new Date(),
      // Only knowable at the end of a stream.
      total: rowsRead,
      errorCount: skipped.length,
      errorsJson: skipped.length
        ? JSON.stringify(
            skipped.slice(-50).map((s) => ({
              id: s.rowNumber != null ? `row ${s.rowNumber}` : 'unknown row',
              error: s.message,
            })),
          )
        : null,
    });

    this.logger.log(
      `[import] run ${runId} staged: ${rowsStaged} rows, ${messagesStaged} messages` +
        (skipped.length ? `, ${skipped.length} unreadable records` : ''),
    );
  }

  private toConversationRow(
    id: string,
    runId: string,
    staged: StagedRow,
    mapping: SourceMapping,
  ): Partial<ImportConversation> {
    const p = staged.projected;
    return {
      id,
      importRunId: runId,
      rowNumber: staged.rowNumber,
      sourceKey: mapping.key,
      srcConversationId: p.srcConversationId,
      srcSessionId: p.srcSessionId,
      srcInteractionContextId: p.srcInteractionContextId,
      // A key that failed E_KEY_TOO_LONG is staged truncated so the column
      // accepts it; the full value is preserved in validationJson and rawJson,
      // and the row is excluded from promote regardless.
      interactionId: p.interactionId ? p.interactionId.slice(0, 50) : null,
      interactionTpsId: p.interactionTpsId ? p.interactionTpsId.slice(0, 50) : null,
      interactionDateTime: p.interactionDateTime,
      campaign: p.campaign,
      agent: p.agent,
      dealer: p.dealer,
      outcome: p.outcome,
      vehicleMake: p.vehicleMake,
      vehicleModel: p.vehicleModel,
      skill: p.skill,
      agentGroup: p.agentGroup,
      lob: p.lob,
      locationName: p.locationName,
      durationSeconds: p.durationSeconds,
      srcMessageCount: p.srcMessageCount,
      srcMessageCountAgent: p.srcMessageCountAgent,
      srcMessageCountConsumer: p.srcMessageCountConsumer,
      closeReason: p.closeReason,
      isPartial: p.isPartial,
      isTruncated: p.isTruncated,
      csatScore: p.csatScore,
      csatScoreMax: p.csatScoreMax,
      csatComment: p.csatComment,
      csatRespondedAt: p.csatRespondedAt,
      mcs: p.mcs,
      alertedMcs: p.alertedMcs,
      surveyType: p.surveyType,
      surveyStatus: p.surveyStatus,
      surveyAnswersJson: staged.surveyAnswers.length
        ? JSON.stringify(staged.surveyAnswers)
        : null,
      transcriptRaw: p.transcriptRaw,
      transcriptJson: staged.transcript.transcriptJson,
      transcriptMessageCount: staged.transcript.includedCount,
      transcriptParseStatus: staged.transcript.status,
      summaryText: p.summaryText,
      rawJson: staged.rawJson,
      piiRedacted: staged.droppedColumns.length > 0,
      validationStatus: staged.validationStatus,
      validationJson: staged.issues.length ? JSON.stringify(staged.issues) : null,
      excluded: staged.excluded,
      excludedReason: staged.excluded
        ? 'Validation errors prevent import'
        : null,
      excludedBy: null,
      promoteStatus: 'pending',
    };
  }

  /**
   * Cross-row checks. These need the whole run staged, so they are set-based SQL
   * rather than per-row TypeScript.
   *
   * Precedence: error > duplicate > existing > warning > valid. Each pass
   * therefore refuses to downgrade a row already marked with something stronger.
   */
  async runValidationPasses(runId: string): Promise<void> {
    // In-file duplicates: the earliest row by rowNumber wins.
    await this.ds.query(
      `WITH d AS (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY srcConversationId ORDER BY rowNumber) AS rn
           FROM app.import_conversations
          WHERE importRunId = @0 AND srcConversationId IS NOT NULL
       )
       UPDATE c
          SET validationStatus = 'duplicate',
              excluded = 1,
              excludedReason = 'Duplicate of an earlier row in this file'
         FROM app.import_conversations c
         JOIN d ON d.id = c.id
        WHERE d.rn > 1 AND c.validationStatus <> 'error'`,
      [runId],
    );

    // Already live in app.interactions.
    await this.ds.query(
      `UPDATE c
          SET validationStatus = 'existing',
              excluded = 1,
              excludedReason = 'Already imported'
         FROM app.import_conversations c
        WHERE c.importRunId = @0
          AND c.validationStatus NOT IN ('error', 'duplicate')
          AND EXISTS (
                SELECT 1 FROM app.interactions i
                 WHERE i.interactionSource = c.sourceKey
                   AND i.interactionId = c.interactionId)`,
      [runId],
    );

    // Promoted by an earlier run whose staging rows are still around.
    await this.ds.query(
      `UPDATE c
          SET validationStatus = 'existing',
              excluded = 1,
              excludedReason = 'Promoted by an earlier import run'
         FROM app.import_conversations c
        WHERE c.importRunId = @0
          AND c.validationStatus NOT IN ('error', 'duplicate')
          AND EXISTS (
                SELECT 1 FROM app.import_conversations p
                 WHERE p.sourceKey = c.sourceKey
                   AND p.srcConversationId = c.srcConversationId
                   AND p.promoteStatus = 'promoted'
                   AND p.importRunId <> @0)`,
      [runId],
    );

    // Two rows resolving to the same interactionTpsId, both carrying a CSAT
    // score, would violate the UNIQUE index IX_interaction_csat_tpsid partway
    // through the promote batch. Catch it here instead.
    await this.ds.query(
      `UPDATE c
          SET validationStatus = 'error',
              excluded = 1,
              excludedReason = 'Another row in this file has the same CSAT match key'
         FROM app.import_conversations c
        WHERE c.importRunId = @0
          AND c.csatScore IS NOT NULL
          AND c.interactionTpsId IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM app.import_conversations x
                 WHERE x.importRunId = @0
                   AND x.interactionTpsId = c.interactionTpsId
                   AND x.csatScore IS NOT NULL
                   AND x.id <> c.id
                   AND x.rowNumber < c.rowNumber)`,
      [runId],
    );
  }

  /** Recomputes the run's counters from its staged rows. */
  async refreshRunCounts(runId: string): Promise<void> {
    await this.ds.query(
      `UPDATE r
          SET rowsValid     = s.valid,
              rowsWarning   = s.warning,
              rowsError     = s.err,
              rowsDuplicate = s.dupe,
              rowsExisting  = s.existing,
              rowsExcluded  = s.excluded
         FROM app.import_runs r
        CROSS APPLY (
          SELECT
            SUM(CASE WHEN validationStatus = 'valid'     THEN 1 ELSE 0 END) AS valid,
            SUM(CASE WHEN validationStatus = 'warning'   THEN 1 ELSE 0 END) AS warning,
            SUM(CASE WHEN validationStatus = 'error'     THEN 1 ELSE 0 END) AS err,
            SUM(CASE WHEN validationStatus = 'duplicate' THEN 1 ELSE 0 END) AS dupe,
            SUM(CASE WHEN validationStatus = 'existing'  THEN 1 ELSE 0 END) AS existing,
            SUM(CASE WHEN excluded = 1                   THEN 1 ELSE 0 END) AS excluded
          FROM app.import_conversations c
         WHERE c.importRunId = r.id
        ) s
        WHERE r.id = @0`,
      [runId],
    );
  }

  /**
   * Re-runs validation, clearing machine exclusions but preserving human ones.
   * Used after a re-key, or when the operator wants a clean slate.
   */
  async revalidate(runId: string): Promise<void> {
    await this.ds.query(
      `UPDATE app.import_conversations
          SET validationStatus = CASE
                WHEN validationJson IS NULL THEN 'valid'
                WHEN validationJson LIKE '%"level":"error"%' THEN 'error'
                ELSE 'warning' END,
              excluded = CASE
                WHEN excludedBy IS NOT NULL THEN 1
                WHEN validationJson LIKE '%"level":"error"%' THEN 1
                ELSE 0 END,
              excludedReason = CASE
                WHEN excludedBy IS NOT NULL THEN excludedReason
                WHEN validationJson LIKE '%"level":"error"%'
                  THEN 'Validation errors prevent import'
                ELSE NULL END
        WHERE importRunId = @0
          AND promoteStatus <> 'promoted'`,
      [runId],
    );
    await this.runValidationPasses(runId);
    await this.refreshRunCounts(runId);
  }

  /**
   * Re-derives the conversation key from a different column using the rawJson
   * already in staging — no file access, so a wrong key column can be corrected
   * without re-uploading.
   *
   * Re-PROJECTS each row through stageRow() rather than patching columns in SQL.
   * The first version updated the key columns and appended E_NO_KEY to
   * validationJson by string concatenation, which made rekey a ONE-WAY DOOR:
   * pointing at a blank column errored every row, and pointing back restored the
   * ids but left the injected error in validationJson forever, so the rows stayed
   * excluded permanently and even revalidate could not recover them. Issues must
   * be recomputed, never accumulated.
   *
   * Messages are left alone: they depend on the transcript and interactionDateTime,
   * neither of which the key affects.
   */
  async rekey(
    runId: string,
    naturalKeyColumn: string,
    mapping: SourceMapping,
  ): Promise<{ updated: number }> {
    const run = await this.runsRepo.findOne({ where: { id: runId } });
    if (!run) return { updated: 0 };
    const headers: string[] = run.headerJson ? JSON.parse(run.headerJson) : [];

    let updated = 0;
    const PAGE = 200;

    for (let offset = 0; ; offset += PAGE) {
      const page = await this.convRepo.find({
        where: { importRunId: runId },
        order: { rowNumber: 'ASC' },
        skip: offset,
        take: PAGE,
      });
      if (page.length === 0) break;

      for (const conv of page) {
        // Promoted rows are immutable — changing their key would orphan the
        // interaction they already created.
        if (conv.promoteStatus === 'promoted') continue;

        let row: Record<string, string>;
        try {
          row = JSON.parse(conv.rawJson) as Record<string, string>;
        } catch {
          continue;
        }

        const staged = stageRow({
          row,
          headers,
          rowNumber: conv.rowNumber,
          mapping,
          naturalKeyColumn,
        });

        // A human exclusion survives a rekey; a machine one is re-derived.
        const humanExcluded = !!conv.excludedBy;

        await this.convRepo.update(conv.id, {
          srcConversationId: staged.projected.srcConversationId,
          interactionId: staged.projected.interactionId
            ? staged.projected.interactionId.slice(0, 50)
            : null,
          interactionTpsId: staged.projected.interactionTpsId
            ? staged.projected.interactionTpsId.slice(0, 50)
            : null,
          validationStatus: staged.validationStatus,
          validationJson: staged.issues.length
            ? JSON.stringify(staged.issues)
            : null,
          excluded: humanExcluded || staged.excluded,
          excludedReason: humanExcluded
            ? conv.excludedReason
            : staged.excluded
              ? 'Validation errors prevent import'
              : null,
        });
        updated++;
      }
    }

    await this.runsRepo.update(runId, { naturalKeyColumn });
    // Cross-row checks depend on the new keys, so they must run again.
    await this.runValidationPasses(runId);
    await this.refreshRunCounts(runId);

    return { updated };
  }
}
