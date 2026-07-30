// Read-only side of the data importer: source discovery, inbox listing and the
// preview pass.
//
// Preview writes nothing — no staging tables, no app.* rows. It exists so the
// mapping can be validated against a real file before anything is imported, and
// so the operator can confirm the delimiter, encoding and natural-key column.

import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  SourceMapping,
  SourceRow,
  ValidationStatus,
} from './mappings/mapping.types';
import { getSourceMapping, listSourceMappings } from './mappings/source-mappings';
import { describeDelimiter } from './helpers/csv-sniff';
import {
  ReaderPlan,
  SkippedRow,
  expectedColumnCount,
  iterateRows,
  planRead,
} from './helpers/delimited-reader';
import {
  StagedRow,
  naturalKeyColumnLabel,
  resolveNaturalKeyColumn,
  stageRow,
} from './helpers/validate-row';
import {
  InboxFile,
  fileSize,
  listInboxFiles,
  resolveInboxFile,
} from './helpers/file-source';

/** Rows read for a preview. Enough to be representative, small enough to be fast. */
export const PREVIEW_ROW_LIMIT = 200;
/** Rows returned to the browser in full detail. */
export const PREVIEW_SAMPLE_SIZE = 20;

export interface ColumnMappingReport {
  /** target <- resolved header, for columns actually present in the file. */
  mapped: Array<{ target: string; column: string }>;
  /** Columns the mapping wants but the file does not have. */
  missing: Array<{ target: string; columns: string[] }>;
  /** Headers present in the file that no field map consumes. */
  unmapped: string[];
  /** Headers dropped by the PII policy before rawJson is built. */
  droppedByPolicy: string[];
}

export interface PreviewSampleRow {
  rowNumber: number;
  validationStatus: ValidationStatus;
  conversationId: string | null;
  interactionDateTime: string | null;
  campaign: string | null;
  agent: string | null;
  outcome: string | null;
  csatScore: number | null;
  mcs: number | null;
  transcriptParseStatus: string;
  transcriptMessageCount: number;
  unknownSpeakerCount: number;
  issues: Array<{ level: string; code: string; message: string }>;
  /** Parsed messages, so the operator sees the bubbles before promoting. */
  messages: Array<{
    seq: number;
    source: string;
    sender: string;
    timestampIso: string | null;
    dayOffset: number;
    included: boolean;
    contentPreview: string;
  }>;
}

export interface PreviewResult {
  sourceKey: string;
  sourceLabel: string;
  mappingVersion: string;
  file: { name: string; sizeBytes: number | null; intake: 'upload' | 'server' };
  encoding: string;
  delimiter: string;
  delimiterLabel: string;
  delimiterCounts: Record<string, number>;
  headerColumnCount: number;
  headers: string[];
  naturalKeyColumn: string | null;
  naturalKeyColumnLabel: string | null;
  columnMapping: ColumnMappingReport;
  rowsRead: number;
  /** True when the file has more rows than the preview limit. */
  truncated: boolean;
  issueCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  transcriptStatusCounts: Record<string, number>;
  duplicateKeysInSample: string[];
  skipped: SkippedRow[];
  sampleRows: PreviewSampleRow[];
}

@Injectable()
export class DataImportService {
  private readonly logger = new Logger(DataImportService.name);

  constructor(private readonly jwt: JwtService) {}

  // ─── role gate ─────────────────────────────────────────────────────────────
  // JwtAuthGuard exists in this codebase but is never registered, so every
  // handler must gate itself. Mirrors HealthService.requireRole.
  requireRole(authHeader: string | undefined, allowed: string[]): { roleId: string } {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    let roleId: string | null = null;
    try {
      const payload: { roleId?: string | null } = this.jwt.verify(
        authHeader.slice('Bearer '.length),
      );
      roleId = payload.roleId ?? null;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    const normalised = String(roleId ?? '').trim().toLowerCase();
    if (!allowed.includes(normalised)) {
      throw new ForbiddenException('Insufficient role');
    }
    return { roleId: normalised };
  }

  // ─── sources ───────────────────────────────────────────────────────────────
  listSources() {
    return listSourceMappings().map((m) => ({
      key: m.key,
      label: m.label,
      version: m.version,
      delimiter: m.delimiter,
      dateOrder: m.dateOrder,
      naturalKeyCandidates: m.naturalKeyCandidates,
      expectedColumns: expectedColumnCount(m),
      interactionDefaults: m.interactionDefaults,
      piiDropColumns: m.pii.dropColumns,
      targetFields: m.fields.map((f) => ({
        target: f.target,
        columns: f.column
          ? Array.isArray(f.column)
            ? f.column
            : [f.column]
          : [],
        const: f.const ?? null,
        maxLength: f.maxLength ?? null,
        hardKey: !!f.hardKey,
      })),
    }));
  }

  requireMapping(sourceKey: string): SourceMapping {
    const mapping = getSourceMapping(sourceKey);
    if (!mapping) {
      const known = listSourceMappings()
        .map((m) => m.key)
        .join(', ');
      throw new ForbiddenException(
        `Unknown import source "${sourceKey}". Known sources: ${known}.`,
      );
    }
    return mapping;
  }

  // ─── inbox ─────────────────────────────────────────────────────────────────
  async listServerFiles(): Promise<InboxFile[]> {
    return listInboxFiles();
  }

  // ─── preview ───────────────────────────────────────────────────────────────
  /**
   * Parses the head of a file and reports what would be staged, without writing
   * anything. Safe to run against an unknown file: the sniff sanity gate rejects
   * a wrong-shaped export before any row is projected.
   */
  async preview(args: {
    filePath: string;
    displayName: string;
    intake: 'upload' | 'server';
    sourceKey: string;
    naturalKeyColumnOverride?: string;
  }): Promise<PreviewResult> {
    const mapping = this.requireMapping(args.sourceKey);
    const plan = await planRead(args.filePath, mapping);

    const skipped: SkippedRow[] = [];
    const read: Array<{ row: SourceRow; rowNumber: number; fieldCount: number }> = [];
    for await (const r of iterateRows(plan, {
      // One extra row so `truncated` can be reported honestly.
      limit: PREVIEW_ROW_LIMIT + 1,
      onSkip: (s) => skipped.push(s),
    })) {
      read.push(r);
    }

    const truncated = read.length > PREVIEW_ROW_LIMIT;
    const rows = truncated ? read.slice(0, PREVIEW_ROW_LIMIT) : read;

    const naturalKeyColumn =
      args.naturalKeyColumnOverride ??
      resolveNaturalKeyColumn(
        plan.headers,
        mapping,
        rows.slice(0, 20).map((r) => r.row),
      );

    const staged = rows.map(({ row, rowNumber, fieldCount }) =>
      stageRow({
        row,
        headers: plan.headers,
        rowNumber,
        mapping,
        naturalKeyColumn,
        fieldCount,
      }),
    );

    let sizeBytes: number | null = null;
    try {
      sizeBytes = await fileSize(args.filePath);
    } catch {
      // Size is informational only; a preview must not fail over it.
    }

    return {
      sourceKey: mapping.key,
      sourceLabel: mapping.label,
      mappingVersion: mapping.version,
      file: { name: args.displayName, sizeBytes, intake: args.intake },
      encoding: plan.encoding,
      delimiter: plan.delimiter,
      delimiterLabel: describeDelimiter(plan.delimiter),
      delimiterCounts: plan.delimiterCounts,
      headerColumnCount: plan.headerColumnCount,
      headers: plan.headers,
      naturalKeyColumn,
      naturalKeyColumnLabel: naturalKeyColumnLabel(naturalKeyColumn, plan.headers),
      columnMapping: this.buildColumnMappingReport(plan, mapping, staged),
      rowsRead: staged.length,
      truncated,
      issueCounts: countBy(staged.flatMap((r) => r.issues.map((i) => i.code))),
      statusCounts: countBy(staged.map((r) => r.validationStatus)),
      transcriptStatusCounts: countBy(staged.map((r) => r.transcript.status)),
      duplicateKeysInSample: findDuplicateKeys(staged),
      skipped,
      sampleRows: staged.slice(0, PREVIEW_SAMPLE_SIZE).map(toSampleRow),
    };
  }

  /**
   * Resolves an inbox file name to a path, applying the traversal guard. Kept on
   * the service so the controller never touches the filesystem directly.
   */
  async resolveServerFile(name: string): Promise<string> {
    return resolveInboxFile(name);
  }

  private buildColumnMappingReport(
    plan: ReaderPlan,
    mapping: SourceMapping,
    staged: StagedRow[],
  ): ColumnMappingReport {
    const headerSet = new Set(plan.headers);
    const mapped: Array<{ target: string; column: string }> = [];
    const missing: Array<{ target: string; columns: string[] }> = [];
    const consumed = new Set<string>();

    const consider = (target: string, columns: string[]) => {
      const hit = columns.find((c) =>
        c.startsWith('#')
          ? Number(c.slice(1)) >= 1 && Number(c.slice(1)) <= plan.headers.length
          : headerSet.has(c),
      );
      if (hit) {
        const resolved = hit.startsWith('#')
          ? plan.headers[Number(hit.slice(1)) - 1]!
          : hit;
        mapped.push({ target, column: resolved });
        columns.forEach((c) => headerSet.has(c) && consumed.add(c));
      } else {
        missing.push({ target, columns });
      }
    };

    for (const field of mapping.fields) {
      if (!field.column) continue;
      consider(
        field.target,
        Array.isArray(field.column) ? field.column : [field.column],
      );
    }
    consider('transcript', [mapping.transcript.column]);
    consider('csatComment', mapping.csat.commentColumns);
    for (const pair of mapping.survey.pairs) {
      [
        pair.question,
        pair.answer,
        pair.questionId,
        pair.answerId,
        pair.questionType,
        pair.questionFormat,
      ]
        .filter((c): c is string => !!c)
        .forEach((c) => headerSet.has(c) && consumed.add(c));
    }
    for (const c of [
      mapping.transcript.agentColumn,
      mapping.transcript.consumerColumn,
      ...mapping.transcript.agentNameColumns,
    ]) {
      if (c && headerSet.has(c)) consumed.add(c);
    }

    const droppedByPolicy = staged[0]?.droppedColumns ?? [];
    const droppedSet = new Set(droppedByPolicy);
    const unmapped = plan.headers.filter(
      (h) => !consumed.has(h) && !droppedSet.has(h),
    );

    return { mapped, missing, unmapped, droppedByPolicy };
  }
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, v) => {
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
}

function findDuplicateKeys(staged: StagedRow[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of staged) {
    const key = r.projected.srcConversationId;
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return [...dupes];
}

function toSampleRow(r: StagedRow): PreviewSampleRow {
  return {
    rowNumber: r.rowNumber,
    validationStatus: r.validationStatus,
    conversationId: r.projected.srcConversationId,
    interactionDateTime: r.projected.interactionDateTime
      ? r.projected.interactionDateTime.toISOString()
      : null,
    campaign: r.projected.campaign,
    agent: r.projected.agent,
    outcome: r.projected.outcome,
    csatScore: r.projected.csatScore,
    mcs: r.projected.mcs,
    transcriptParseStatus: r.transcript.status,
    transcriptMessageCount: r.transcript.includedCount,
    unknownSpeakerCount: r.transcript.unknownSpeakerCount,
    issues: r.issues.map((i) => ({
      level: i.level,
      code: i.code,
      message: i.message,
    })),
    messages: r.transcript.messages.slice(0, 50).map((m) => ({
      seq: m.seq,
      source: m.source,
      sender: m.sender,
      timestampIso: m.timestampIso,
      dayOffset: m.dayOffset,
      included: m.includedInTranscript,
      contentPreview:
        m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content,
    })),
  };
}
