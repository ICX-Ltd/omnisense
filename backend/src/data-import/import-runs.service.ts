// Read and mutate side of staged import runs: listing, row paging, per-row
// detail, exclude/include and discard.
//
// The row grid is server-capped. CsatDashboard loads every row it is given and
// has no pagination; copying that here would hang the browser on a 300k-row
// staging run, so `rows` takes an explicit limit with a hard ceiling.

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ImportConversation } from '../db/entities/import-conversation.entity';
import { ImportMessage } from '../db/entities/import-message.entity';
import { ImportRun } from '../db/entities/import-run.entity';
import { RowIssue } from './mappings/mapping.types';
import { getSourceMapping } from './mappings/source-mappings';
import {
  matchesDropPattern,
  naturalKeyColumnLabel,
} from './helpers/validate-row';

/** Default and ceiling for the rows grid. */
export const ROWS_DEFAULT_LIMIT = 200;
export const ROWS_MAX_LIMIT = 2000;

export interface ListRowsQuery {
  status?: string;
  onlyIssues?: boolean;
  /** Substring match against the conversation id / session id / agent. */
  q?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ImportRunsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ImportRun)
    private readonly runsRepo: Repository<ImportRun>,
    @InjectRepository(ImportConversation)
    private readonly convRepo: Repository<ImportConversation>,
    @InjectRepository(ImportMessage)
    private readonly msgRepo: Repository<ImportMessage>,
  ) {}

  async listRuns(limit = 25) {
    const runs = await this.runsRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return runs.map((r) => this.serializeRun(r));
  }

  async getRun(runId: string) {
    const run = await this.requireRun(runId);
    return this.serializeRun(run, { includeMapping: true });
  }

  async requireRun(runId: string): Promise<ImportRun> {
    const run = await this.runsRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`No import run ${runId}`);
    return run;
  }

  /** Row grid, filtered and capped server-side. */
  async listRows(runId: string, query: ListRowsQuery) {
    await this.requireRun(runId);

    const limit = Math.min(
      Math.max(query.limit ?? ROWS_DEFAULT_LIMIT, 1),
      ROWS_MAX_LIMIT,
    );
    const offset = Math.max(query.offset ?? 0, 0);

    // Select ONLY what serializeRowSummary returns. Without this TypeORM
    // hydrates every column, including seven nvarchar(MAX) fields — rawJson,
    // transcriptRaw and transcriptJson are multi-KB each, so a 200-row page
    // pulled tens of megabytes to render a grid that displays none of it. That
    // was a 500 on a real 9,742-row run and invisible on a small fixture.
    // validationJson is kept because the row summary derives its issue counts
    // from it, and it is small by comparison.
    const qb = this.convRepo
      .createQueryBuilder('c')
      .select([
        'c.rowNumber',
        'c.validationStatus',
        'c.excluded',
        'c.excludedReason',
        'c.excludedBy',
        'c.promoteStatus',
        'c.promotedInteractionId',
        'c.promoteError',
        'c.srcConversationId',
        'c.srcSessionId',
        'c.interactionId',
        'c.interactionDateTime',
        'c.campaign',
        'c.agent',
        'c.skill',
        'c.outcome',
        'c.durationSeconds',
        'c.csatScore',
        'c.csatScoreMax',
        'c.mcs',
        'c.transcriptParseStatus',
        'c.transcriptMessageCount',
        'c.isPartial',
        'c.isTruncated',
        'c.validationJson',
      ])
      .where('c.importRunId = :runId', { runId });

    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length) {
        qb.andWhere('c.validationStatus IN (:...statuses)', { statuses });
      }
    }
    if (query.onlyIssues) {
      qb.andWhere('c.validationJson IS NOT NULL');
    }
    if (query.q?.trim()) {
      const term = `%${query.q.trim()}%`;
      qb.andWhere(
        '(c.srcConversationId LIKE :term OR c.srcSessionId LIKE :term OR c.agent LIKE :term)',
        { term },
      );
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('c.rowNumber', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return {
      total,
      limit,
      offset,
      // Tells the UI honestly that it is not seeing everything.
      truncated: total > offset + rows.length,
      rows: rows.map((c) => this.serializeRowSummary(c)),
    };
  }

  /** Full detail for one staged row: issues, parsed messages and the raw row. */
  async getRowDetail(runId: string, rowNumber: number) {
    const run = await this.requireRun(runId);
    const conv = await this.convRepo.findOne({
      where: { importRunId: runId, rowNumber },
    });
    if (!conv) {
      throw new NotFoundException(`No row ${rowNumber} in run ${runId}`);
    }

    const messages = await this.msgRepo.find({
      where: { conversationStageId: conv.id },
      order: { seq: 'ASC' },
    });

    const headers: string[] = run.headerJson ? JSON.parse(run.headerJson) : [];
    const rawRow = safeParseObject(conv.rawJson);

    // Report the PII policy from the policy itself, NOT from what is missing
    // out of rawJson: empty cells are omitted there too (a ~330-column export is
    // mostly blank), so inferring from absence reported ~300 "dropped by policy"
    // columns when only ~55 are actually PII.
    const mapping = getSourceMapping(conv.sourceKey);
    const droppedByPolicy = mapping
      ? headers.filter((h) => matchesDropPattern(h, mapping.pii.dropColumns))
      : [];
    // Present in the file, not PII, and simply empty. Useful context, and keeps
    // the two reasons a column is absent clearly distinct.
    const emptyColumns = headers.filter(
      (h) => !(h in rawRow) && !droppedByPolicy.includes(h),
    );

    return {
      ...this.serializeRowSummary(conv),
      issues: parseIssues(conv.validationJson),
      transcriptRaw: conv.transcriptRaw,
      transcriptJson: conv.transcriptJson,
      summaryText: conv.summaryText,
      surveyAnswers: conv.surveyAnswersJson
        ? safeParseArray(conv.surveyAnswersJson)
        : [],
      messages: messages.map((m) => ({
        seq: m.seq,
        source: m.source,
        sender: m.sender,
        timestampText: m.timestampText,
        timestampIso: m.timestampIso,
        dayOffset: m.dayOffset,
        content: m.content,
        isAuto: m.isAuto,
        isHandover: m.isHandover,
        includedInTranscript: m.includedInTranscript,
        parseWarning: m.parseWarning,
      })),
      raw: rawRow,
      // Surfaced so the operator can see the PII policy is actually applied,
      // rather than having to trust it.
      droppedByPolicy,
      emptyColumnCount: emptyColumns.length,
    };
  }

  /** Exclude or re-include a single row. Records who did it. */
  async setRowExcluded(
    runId: string,
    rowNumber: number,
    excluded: boolean,
    reason: string | null,
    actor: string,
  ) {
    const run = await this.requireRun(runId);
    this.assertMutable(run);

    const conv = await this.convRepo.findOne({
      where: { importRunId: runId, rowNumber },
    });
    if (!conv) throw new NotFoundException(`No row ${rowNumber} in run ${runId}`);
    if (conv.promoteStatus === 'promoted') {
      throw new BadRequestException(
        'This row has already been promoted; roll the run back to change it.',
      );
    }
    // An error row can never be promoted, so allowing it to be re-included would
    // be a lie to the operator.
    if (!excluded && conv.validationStatus === 'error') {
      throw new BadRequestException(
        'This row has validation errors and cannot be included.',
      );
    }

    await this.convRepo.update(conv.id, {
      excluded,
      excludedReason: excluded ? (reason ?? 'Excluded by operator') : null,
      // excludedBy marks a human decision, which revalidate must preserve.
      excludedBy: excluded ? actor : null,
    });
    await this.refreshCounts(runId);
    return { rowNumber, excluded };
  }

  /** Bulk exclude by validation status, e.g. "exclude all warnings". */
  async excludeByStatus(
    runId: string,
    statuses: string[],
    reason: string,
    actor: string,
  ): Promise<{ excluded: number }> {
    const run = await this.requireRun(runId);
    this.assertMutable(run);
    if (!statuses.length) {
      throw new BadRequestException('No statuses supplied');
    }

    // Statuses are parameterised, never interpolated — the DTO restricts them to
    // a known set, but building the IN list from placeholders keeps that from
    // being the only thing standing between this and an injection.
    const statusParams = statuses.map((_, i) => `@${i + 3}`).join(', ');
    const result = await this.ds.query(
      `UPDATE app.import_conversations
          SET excluded = 1, excludedReason = @1, excludedBy = @2
        WHERE importRunId = @0
          AND promoteStatus <> 'promoted'
          AND excluded = 0
          AND validationStatus IN (${statusParams});
       SELECT @@ROWCOUNT AS affected;`,
      [runId, reason, actor, ...statuses],
    );
    await this.refreshCounts(runId);
    return { excluded: Number(result?.[0]?.affected ?? 0) };
  }

  /**
   * Deletes a run and everything staged under it. The FK cascade removes
   * conversations and their messages, so this is one statement.
   */
  async discardRun(runId: string): Promise<{ discarded: true }> {
    const run = await this.requireRun(runId);
    if (run.status === 'promoted' || run.promotedInteractions) {
      throw new BadRequestException(
        'This run has been promoted. Roll it back before discarding, otherwise ' +
          'the promoted interactions would be left with no audit trail.',
      );
    }
    await this.runsRepo.delete(runId);
    return { discarded: true };
  }

  /**
   * Drops the staged rows but keeps the run header as an audit record. Staging
   * duplicates every transcript, so a large import roughly doubles that storage
   * until it is purged.
   */
  async purgeStaging(runId: string): Promise<{ purged: number }> {
    const run = await this.requireRun(runId);
    if (run.status !== 'promoted') {
      throw new BadRequestException(
        'Only a promoted run can have its staging purged — otherwise the rows ' +
          'would be lost before they were imported.',
      );
    }
    const result = await this.ds.query(
      `DELETE FROM app.import_conversations WHERE importRunId = @0;
       SELECT @@ROWCOUNT AS affected;`,
      [runId],
    );
    await this.runsRepo.update(runId, { purgedAt: new Date() });
    return { purged: Number(result?.[0]?.affected ?? 0) };
  }

  private assertMutable(run: ImportRun): void {
    if (run.status === 'parsing' || run.status === 'promoting') {
      throw new BadRequestException(
        `This run is currently ${run.status}; wait for it to finish.`,
      );
    }
  }

  private async refreshCounts(runId: string): Promise<void> {
    await this.ds.query(
      `UPDATE r SET rowsExcluded = s.excluded
         FROM app.import_runs r
        CROSS APPLY (
          SELECT SUM(CASE WHEN excluded = 1 THEN 1 ELSE 0 END) AS excluded
            FROM app.import_conversations c WHERE c.importRunId = r.id
        ) s
        WHERE r.id = @0`,
      [runId],
    );
  }

  private serializeRun(run: ImportRun, opts: { includeMapping?: boolean } = {}) {
    const headers: string[] = run.headerJson ? JSON.parse(run.headerJson) : [];
    const base = {
      id: run.id,
      sourceKey: run.sourceKey,
      clientId: run.clientId,
      mappingVersion: run.mappingVersion,
      intake: run.intake,
      originalFilename: run.originalFilename,
      fileSizeBytes: run.fileSizeBytes != null ? Number(run.fileSizeBytes) : null,
      delimiter: run.delimiter,
      encoding: run.encoding,
      status: run.status,
      naturalKeyColumn: run.naturalKeyColumn,
      naturalKeyColumnLabel: naturalKeyColumnLabel(run.naturalKeyColumn, headers),
      counts: {
        read: run.rowsRead ?? 0,
        staged: run.rowsStaged ?? 0,
        skipped: run.rowsSkipped ?? 0,
        valid: run.rowsValid ?? 0,
        warning: run.rowsWarning ?? 0,
        error: run.rowsError ?? 0,
        duplicate: run.rowsDuplicate ?? 0,
        existing: run.rowsExisting ?? 0,
        excluded: run.rowsExcluded ?? 0,
        messages: run.messagesStaged ?? 0,
        transcriptsParsed: run.transcriptsParsed ?? 0,
        transcriptsPartial: run.transcriptsPartial ?? 0,
        transcriptsFailed: run.transcriptsFailed ?? 0,
      },
      promoted: {
        interactions: run.promotedInteractions ?? 0,
        transcripts: run.promotedTranscripts ?? 0,
        csat: run.promotedCsat ?? 0,
        surveys: run.promotedSurveys ?? 0,
        skipped: run.promoteSkipped ?? 0,
      },
      parseJobId: run.parseJobId,
      promoteJobId: run.promoteJobId,
      lastError: run.lastError,
      createdBy: run.createdBy,
      createdAt: run.createdAt?.toISOString() ?? null,
      stagedAt: run.stagedAt?.toISOString() ?? null,
      promotedAt: run.promotedAt?.toISOString() ?? null,
      rolledBackAt: run.rolledBackAt?.toISOString() ?? null,
      purgedAt: run.purgedAt?.toISOString() ?? null,
    };

    if (!opts.includeMapping) return base;
    return {
      ...base,
      headers,
      headerColumnCount: headers.length,
      mappedColumns: run.mappedColumnsJson
        ? safeParseArray(run.mappedColumnsJson)
        : [],
      unmappedColumns: run.unmappedColumnsJson
        ? safeParseArray(run.unmappedColumnsJson)
        : [],
      missingColumns: run.missingColumnsJson
        ? safeParseArray(run.missingColumnsJson)
        : [],
    };
  }

  private serializeRowSummary(c: ImportConversation) {
    const issues = parseIssues(c.validationJson);
    return {
      rowNumber: c.rowNumber,
      validationStatus: c.validationStatus,
      excluded: c.excluded,
      excludedReason: c.excludedReason,
      excludedByOperator: !!c.excludedBy,
      promoteStatus: c.promoteStatus,
      promotedInteractionId: c.promotedInteractionId,
      promoteError: c.promoteError,
      conversationId: c.srcConversationId,
      sessionId: c.srcSessionId,
      interactionId: c.interactionId,
      interactionDateTime: c.interactionDateTime?.toISOString() ?? null,
      campaign: c.campaign,
      agent: c.agent,
      skill: c.skill,
      outcome: c.outcome,
      durationSeconds: c.durationSeconds,
      csatScore: c.csatScore,
      csatScoreMax: c.csatScoreMax,
      mcs: c.mcs,
      transcriptParseStatus: c.transcriptParseStatus,
      transcriptMessageCount: c.transcriptMessageCount,
      isPartial: c.isPartial,
      isTruncated: c.isTruncated,
      errorCount: issues.filter((i) => i.level === 'error').length,
      warningCount: issues.filter((i) => i.level === 'warning').length,
      issueCodes: issues.map((i) => i.code),
    };
  }
}

function parseIssues(json: string | null): RowIssue[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RowIssue[]) : [];
  } catch {
    return [];
  }
}

function safeParseArray(json: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObject(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}
