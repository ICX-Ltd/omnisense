// Projects one source row onto the canonical staging shape and validates it.
//
// Everything that can go wrong with a row is decided here, once, at stage time —
// never at promote time. That ordering is deliberate: what the operator sees in
// the eyeball grid is exactly what will land, including any truncation.

import {
  FieldMap,
  ProjectedRow,
  RowIssue,
  SourceMapping,
  SourceRow,
  ValidationStatus,
} from '../mappings/mapping.types';
import { parseSourceDateTime } from './parse-date';
import { NormalisedTranscript, normaliseTranscript } from './transcript-normalise';

/**
 * Width of app.interactions.interactionId and .interactionTpsId. These are
 * identifiers: truncating one would silently break idempotency and let the same
 * conversation import twice, so over-length is an error, not a truncation.
 */
export const KEY_MAX_LENGTH = 50;

const EMPTY_PROJECTION: ProjectedRow = {
  srcConversationId: null,
  srcSessionId: null,
  srcInteractionContextId: null,
  interactionId: null,
  interactionTpsId: null,
  interactionDateTime: null,
  campaign: null,
  agent: null,
  dealer: null,
  outcome: null,
  vehicleMake: null,
  vehicleModel: null,
  skill: null,
  agentGroup: null,
  lob: null,
  locationName: null,
  durationSeconds: null,
  srcMessageCount: null,
  srcMessageCountAgent: null,
  srcMessageCountConsumer: null,
  closeReason: null,
  isPartial: null,
  isTruncated: null,
  csatScore: null,
  csatScoreMax: null,
  csatComment: null,
  csatRespondedAt: null,
  mcs: null,
  alertedMcs: null,
  surveyType: null,
  surveyStatus: null,
  transcriptRaw: null,
  summaryText: null,
};

/** Resolves a `#N` positional reference (1-based) or a header name to a value. */
function readColumn(
  row: SourceRow,
  headers: string[],
  name: string,
): string | undefined {
  if (name.startsWith('#')) {
    const idx = Number(name.slice(1));
    if (!Number.isInteger(idx) || idx < 1 || idx > headers.length) return undefined;
    return row[headers[idx - 1]!];
  }
  return row[name];
}

/** First non-empty value across one or more candidate columns. */
export function readFirstNonEmpty(
  row: SourceRow,
  headers: string[],
  columns: string | string[],
): { value: string; column: string } | null {
  const list = Array.isArray(columns) ? columns : [columns];
  for (const name of list) {
    const raw = readColumn(row, headers, name);
    if (raw != null && String(raw).trim() !== '') {
      return { value: String(raw), column: name };
    }
  }
  return null;
}

function parseIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Tolerate thousands separators and a trailing ".0" from spreadsheet exports.
  const cleaned = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Math.trunc(Number(cleaned));
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 't']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'f']);

function parseBoolOrNull(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return null;
}

/** Applies one FieldMap, appending any issues it raises. */
function applyField(
  field: FieldMap,
  row: SourceRow,
  headers: string[],
  mapping: SourceMapping,
  out: Record<string, unknown>,
  issues: RowIssue[],
): void {
  if (field.const !== undefined) {
    out[field.target] = field.const;
    return;
  }
  if (!field.column) return;

  // Conditional fields: LivePerson reports csatRate as 0 unless a survey was
  // actually answered, so an unanswered survey must not look like a score of 0.
  if (field.requiresPositive) {
    const gate = readFirstNonEmpty(row, headers, field.requiresPositive);
    const gateValue = gate ? parseIntOrNull(gate.value) : null;
    if (gateValue === null || gateValue <= 0) {
      out[field.target] = null;
      return;
    }
  }

  const hit = readFirstNonEmpty(row, headers, field.column);
  let text = hit ? hit.value : '';

  switch (field.transform) {
    case 'int': {
      out[field.target] = text ? parseIntOrNull(text) : null;
      return;
    }
    case 'float': {
      out[field.target] = text ? parseFloatOrNull(text) : null;
      return;
    }
    case 'bool': {
      out[field.target] = text ? parseBoolOrNull(text) : null;
      return;
    }
    case 'datetime': {
      out[field.target] = text
        ? parseSourceDateTime(text, mapping.dateOrder)
        : null;
      return;
    }
    case 'trim':
      text = text.trim();
      break;
    case 'upper':
      text = text.trim().toUpperCase();
      break;
    case 'lower':
      text = text.trim().toLowerCase();
      break;
    default:
      break;
  }

  if (field.aliases) {
    const key = Object.keys(field.aliases).find(
      (k) => k.toLowerCase() === text.trim().toLowerCase(),
    );
    if (key) text = field.aliases[key]!;
  }

  if (text.trim() === '' && field.fallback !== undefined) {
    text = field.fallback;
  }

  if (text === '') {
    out[field.target] = null;
    return;
  }

  if (field.maxLength && text.length > field.maxLength) {
    if (field.hardKey) {
      issues.push({
        level: 'error',
        code: 'E_KEY_TOO_LONG',
        field: field.target,
        message:
          `${field.target} is ${text.length} characters but the column holds ` +
          `${field.maxLength}. Truncating an identifier would break duplicate ` +
          `detection, so this row cannot be imported as-is.`,
        original: text,
      });
      // Keep the full value staged so the UI can show it.
      out[field.target] = text;
      return;
    }
    issues.push({
      level: 'warning',
      code: `W_TRUNC_${field.target}`,
      field: field.target,
      message: `${field.target} truncated from ${text.length} to ${field.maxLength} characters.`,
      original: text,
      truncatedTo: field.maxLength,
    });
    text = text.slice(0, field.maxLength);
  }

  if (field.mustMatch && !new RegExp(field.mustMatch, 'i').test(text)) {
    issues.push({
      level: 'warning',
      code: `W_VALUE_${field.target}`,
      field: field.target,
      message:
        `${field.target} is "${text}", which does not match /${field.mustMatch}/i` +
        (field.mustMatchHint ? ` — ${field.mustMatchHint}.` : '.'),
      original: text,
    });
  }

  out[field.target] = text;
}

/**
 * Picks the natural-key column: the first candidate that exists as a header and
 * holds a value. Falls back to the first candidate that merely exists, so the
 * run still reports a resolved column when a sample row happens to be blank.
 */
export function resolveNaturalKeyColumn(
  headers: string[],
  mapping: SourceMapping,
  sampleRows: SourceRow[] = [],
): string | null {
  const exists = (name: string) =>
    name.startsWith('#')
      ? Number(name.slice(1)) >= 1 && Number(name.slice(1)) <= headers.length
      : headers.includes(name);

  for (const candidate of mapping.naturalKeyCandidates) {
    if (!exists(candidate)) continue;
    if (sampleRows.length === 0) return candidate;
    const populated = sampleRows.some((r) => {
      const v = readColumn(r, headers, candidate);
      return v != null && String(v).trim() !== '';
    });
    if (populated) return candidate;
  }
  return mapping.naturalKeyCandidates.find(exists) ?? null;
}

/** Resolves a positional key column to its header name, for display. */
export function naturalKeyColumnLabel(
  column: string | null,
  headers: string[],
): string | null {
  if (!column) return null;
  if (!column.startsWith('#')) return column;
  const idx = Number(column.slice(1));
  return headers[idx - 1] ?? column;
}

/**
 * Whether a header is removed by the PII policy. A trailing '*' matches by
 * prefix. Exported so the row-detail endpoint can report the policy precisely
 * rather than inferring it from what is absent — rawJson also omits empty cells,
 * so absence alone would mislabel every blank column as a PII drop.
 */
export function matchesDropPattern(header: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p.endsWith('*')) {
      if (header.toLowerCase().startsWith(p.slice(0, -1).toLowerCase())) return true;
    } else if (header.toLowerCase() === p.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Builds the provenance blob, minus the columns the PII policy drops. Applied
 * before serialisation, so dropped values never reach the database at all.
 */
export function buildRawJson(
  row: SourceRow,
  headers: string[],
  mapping: SourceMapping,
): { rawJson: string; droppedColumns: string[] } {
  const kept: Record<string, string> = {};
  const dropped: string[] = [];
  for (const header of headers) {
    if (matchesDropPattern(header, mapping.pii.dropColumns)) {
      dropped.push(header);
      continue;
    }
    const value = row[header];
    // Empty cells are omitted rather than stored as "": a ~330-column export is
    // mostly blank, and keeping them would roughly triple the blob.
    if (value != null && String(value) !== '') kept[header] = String(value);
  }
  return { rawJson: JSON.stringify(kept), droppedColumns: dropped };
}

export interface SurveyAnswer {
  block: string;
  question: string;
  answer: string;
  questionId?: string;
  answerId?: string;
  questionType?: string;
  questionFormat?: string;
}

/**
 * Zips LivePerson's parallel multi-value survey columns into answer objects.
 * Question and answer lists are positional; a mismatched length is tolerated by
 * pairing up to the shorter of the two rather than dropping the block.
 */
export function buildSurveyAnswers(
  row: SourceRow,
  headers: string[],
  mapping: SourceMapping,
): SurveyAnswer[] {
  const split = (value: string | undefined) =>
    value == null || value === ''
      ? []
      : String(value).split(mapping.multiValueDelimiter).map((s) => s.trim());

  const out: SurveyAnswer[] = [];
  for (const pair of mapping.survey.pairs) {
    const questions = split(readColumn(row, headers, pair.question));
    const answers = split(readColumn(row, headers, pair.answer));
    if (questions.length === 0 && answers.length === 0) continue;

    const questionIds = pair.questionId
      ? split(readColumn(row, headers, pair.questionId))
      : [];
    const answerIds = pair.answerId
      ? split(readColumn(row, headers, pair.answerId))
      : [];
    const types = pair.questionType
      ? split(readColumn(row, headers, pair.questionType))
      : [];
    const formats = pair.questionFormat
      ? split(readColumn(row, headers, pair.questionFormat))
      : [];

    const count = Math.max(questions.length, answers.length);
    for (let i = 0; i < count; i++) {
      const question = questions[i] ?? '';
      const answer = answers[i] ?? '';
      if (!question && !answer) continue;
      const entry: SurveyAnswer = { block: pair.block, question, answer };
      if (questionIds[i]) entry.questionId = questionIds[i];
      if (answerIds[i]) entry.answerId = answerIds[i];
      if (types[i]) entry.questionType = types[i];
      if (formats[i]) entry.questionFormat = formats[i];
      out.push(entry);
    }
  }
  return out;
}

export interface StageRowInput {
  row: SourceRow;
  headers: string[];
  rowNumber: number;
  mapping: SourceMapping;
  /** Resolved natural-key column, or a `#N` positional reference. */
  naturalKeyColumn: string | null;
  /** Field count for this record when it differed from the header count. */
  fieldCount?: number;
}

export interface StagedRow {
  rowNumber: number;
  projected: ProjectedRow;
  transcript: NormalisedTranscript;
  surveyAnswers: SurveyAnswer[];
  rawJson: string;
  droppedColumns: string[];
  issues: RowIssue[];
  /** Only valid | warning | error at this stage; duplicate/existing are set by
   *  the set-based post-passes once the whole run is staged. */
  validationStatus: ValidationStatus;
  excluded: boolean;
}

/**
 * Projects and validates a single source row. Pure: no DB, no filesystem, no
 * clock — so the whole mapping can be exercised against a fixture before any
 * real file exists.
 */
export function stageRow(input: StageRowInput): StagedRow {
  const { row, headers, rowNumber, mapping, naturalKeyColumn } = input;
  const issues: RowIssue[] = [];
  const out: Record<string, unknown> = { ...EMPTY_PROJECTION };

  // ── natural key ───────────────────────────────────────────────────────────
  const keyHit = naturalKeyColumn
    ? readFirstNonEmpty(row, headers, naturalKeyColumn)
    : null;
  const key = keyHit ? keyHit.value.trim() : '';

  if (!key) {
    issues.push({
      level: 'error',
      code: 'E_NO_KEY',
      field: 'interactionId',
      message: naturalKeyColumn
        ? `No conversation id in column "${naturalKeyColumnLabel(naturalKeyColumn, headers)}".`
        : 'No conversation-id column could be resolved for this source.',
    });
  } else {
    out.srcConversationId = key.slice(0, 200);
    if (key.length > KEY_MAX_LENGTH) {
      issues.push({
        level: 'error',
        code: 'E_KEY_TOO_LONG',
        field: 'interactionId',
        message:
          `Conversation id is ${key.length} characters but interactionId holds ` +
          `${KEY_MAX_LENGTH}. Truncating it would break duplicate detection.`,
        original: key,
      });
      out.interactionId = key;
      out.interactionTpsId = key;
    } else {
      // Both columns carry the conversation id: interactionTpsId is the CSAT
      // match key (unique index IX_interaction_csat_tpsid), and LivePerson has
      // no separate reference id.
      out.interactionId = key;
      out.interactionTpsId = key;
    }
  }

  // ── mapped fields ─────────────────────────────────────────────────────────
  for (const field of mapping.fields) {
    applyField(field, row, headers, mapping, out, issues);
  }

  // ── CSAT comment (searched across candidate columns) ──────────────────────
  // The source column is MULTI-VALUE: it holds one answer per survey question,
  // delimiter-separated. Taking the cell verbatim glued every answer together
  // ("Waited far too long for recovery;No"), which then landed in
  // interaction_csat.comment and would be read as the customer's verbatim by the
  // contest assessment. Split and take the first non-empty answer; the complete
  // Q&A set is preserved separately in interaction_survey.answersJson.
  const commentHit = readFirstNonEmpty(row, headers, mapping.csat.commentColumns);
  out.csatComment = commentHit
    ? (commentHit.value
        .split(mapping.multiValueDelimiter)
        .map((part) => part.trim())
        .find((part) => part !== '') ?? null)
    : null;

  const projected = out as unknown as ProjectedRow;

  // ── transcript ────────────────────────────────────────────────────────────
  const transcript = normaliseTranscript({
    raw: projected.transcriptRaw,
    agentSide: mapping.transcript.agentColumn
      ? (row[mapping.transcript.agentColumn] ?? null)
      : null,
    consumerSide: mapping.transcript.consumerColumn
      ? (row[mapping.transcript.consumerColumn] ?? null)
      : null,
    anchorDate: projected.interactionDateTime,
    agentNames: mapping.transcript.agentNameColumns
      .map((c) => row[c])
      .filter((v): v is string => !!v && v.trim() !== ''),
    mapping: mapping.transcript,
  });

  // ── row-level rules ───────────────────────────────────────────────────────
  if (!projected.interactionDateTime) {
    issues.push({
      level: 'error',
      code: 'E_NO_DATE',
      field: 'interactionDateTime',
      message:
        'No usable conversation start time — every dashboard filters on date, ' +
        'and the transcript timestamps have nothing to anchor to.',
    });
  }

  if (transcript.status === 'empty') {
    issues.push({
      level: 'error',
      code: 'E_NO_TRANSCRIPT',
      message:
        'No transcript content. interaction_transcripts.text is NOT NULL, so ' +
        'there is nothing to promote.',
    });
  } else if (transcript.status === 'unparsed') {
    issues.push({
      level: 'error',
      code: 'E_TRANSCRIPT_UNPARSED',
      message:
        `Transcript has content but no line matched the expected ` +
        `"HH:MM[:SS] - Speaker: text" format (${transcript.unparsedLineCount} ` +
        `unparsed lines).`,
    });
  } else if (transcript.status === 'partial') {
    issues.push({
      level: 'warning',
      code: 'W_TRANSCRIPT_PARTIAL',
      message:
        `${transcript.includedCount} messages parsed, ` +
        `${transcript.unknownSpeakerCount} with an unrecognised speaker and ` +
        `${transcript.unparsedLineCount} unparsed lines.`,
    });
  }

  if (transcript.unknownSpeakerCount > 0) {
    issues.push({
      level: 'warning',
      code: 'W_UNKNOWN_SPEAKER',
      message:
        `${transcript.unknownSpeakerCount} message(s) have an unrecognised ` +
        `speaker label and are excluded from the promoted transcript, so they ` +
        `will not appear in the chat bubbles or response-time metrics.`,
    });
  }

  if (projected.isPartial === true || projected.isTruncated === true) {
    issues.push({
      level: 'warning',
      code: 'W_PARTIAL_CONVERSATION',
      message:
        'Source marks this conversation as partial or truncated — the ' +
        'transcript may be incomplete.',
    });
  }

  if (!projected.agent) {
    issues.push({
      level: 'warning',
      code: 'W_NO_AGENT',
      field: 'agent',
      message: 'No agent name — this row will not appear in per-agent reporting.',
    });
  }

  if (!projected.campaign) {
    issues.push({
      level: 'warning',
      code: 'W_NO_CAMPAIGN',
      field: 'campaign',
      message: 'No campaign — campaign-specific insight scoring will be skipped.',
    });
  }

  // CSAT present but unscored: the survey was answered yet no rate came through.
  const csatCountHit = readFirstNonEmpty(row, headers, 'csatCount');
  const csatCount = csatCountHit ? parseIntOrNull(csatCountHit.value) : null;
  if (csatCount !== null && csatCount > 0 && projected.csatScore === null) {
    issues.push({
      level: 'warning',
      code: 'W_CSAT_NO_SCORE',
      message: `csatCount is ${csatCount} but no usable csatRate was found.`,
    });
  }

  if (input.fieldCount != null && input.fieldCount !== headers.length) {
    issues.push({
      level: 'warning',
      code: 'W_COLUMN_COUNT',
      message:
        `Row has ${input.fieldCount} fields but the header has ` +
        `${headers.length}. Values may be misaligned.`,
    });
  }

  const { rawJson, droppedColumns } = buildRawJson(row, headers, mapping);
  const surveyAnswers = buildSurveyAnswers(row, headers, mapping);

  const hasError = issues.some((i) => i.level === 'error');
  const validationStatus: ValidationStatus = hasError
    ? 'error'
    : issues.length > 0
      ? 'warning'
      : 'valid';

  return {
    rowNumber,
    projected,
    transcript,
    surveyAnswers,
    rawJson,
    droppedColumns,
    issues,
    validationStatus,
    // Errors are excluded automatically; warnings are promotable unless the
    // operator excludes them.
    excluded: hasError,
  };
}
