// Types for the mapping-driven data importer.
//
// A source file is read as Record<header, rawString> per row. A SourceMapping
// projects that onto ProjectedRow — a canonical shape named after the app.*
// columns it eventually lands in, NOT after the provider's own headers. That
// indirection is the whole point: promote becomes a 1:1 INSERT ... SELECT, and
// adding a second provider means adding a mapping, not changing schema.

/** A source row as read from the file: header name -> raw cell text. */
export type SourceRow = Record<string, string>;

/**
 * Column reference. Either a header name, or an ordered list of header names
 * where the first non-empty value wins (LivePerson has several near-duplicate
 * columns for the same concept). A `#N` entry is a 1-based POSITIONAL
 * reference, used when the header name is unknown or unreliable.
 */
export type ColumnRef = string | string[];

export type Transform =
  | 'trim'
  | 'int'
  | 'float'
  | 'bool'
  | 'datetime'
  | 'upper'
  | 'lower';

/** Fields of ProjectedRow that a FieldMap is allowed to populate. */
export type StagingField =
  // source identity (kept full-length for QA, before any truncation)
  | 'srcConversationId'
  | 'srcSessionId'
  | 'srcInteractionContextId'
  // canonical projection of app.interactions
  | 'interactionId'
  | 'interactionTpsId'
  | 'interactionDateTime'
  | 'campaign'
  | 'agent'
  | 'dealer'
  | 'outcome'
  | 'vehicleMake'
  | 'vehicleModel'
  | 'recordingUrl'
  | 'maturityDate'
  // QA-only: never promoted, but filterable in the eyeball grid
  | 'skill'
  | 'agentGroup'
  | 'lob'
  | 'locationName'
  | 'durationSeconds'
  | 'srcMessageCount'
  | 'srcMessageCountAgent'
  | 'srcMessageCountConsumer'
  | 'closeReason'
  | 'isPartial'
  | 'isTruncated'
  // CSAT / quality
  | 'csatScore'
  | 'csatScoreMax'
  | 'csatComment'
  | 'csatRespondedAt'
  | 'mcs'
  | 'alertedMcs'
  // survey
  | 'surveyType'
  | 'surveyStatus'
  // content
  | 'transcriptRaw'
  | 'summaryText';

export interface FieldMap {
  target: StagingField;
  /** Omitted when `const` is used. */
  column?: ColumnRef;
  /** Literal value, used when the target has no source column. */
  const?: string | number;
  transform?: Transform;
  /**
   * Width of the eventual app.* column. Over-length values are truncated and
   * raise W_TRUNC_<target>, with the original preserved in validationJson.
   */
  maxLength?: number;
  /**
   * Identifier field: truncating it would destroy idempotency, so over-length
   * raises E_KEY_TOO_LONG instead of silently shortening.
   */
  hardKey?: boolean;
  /** Case-insensitive value normalisation applied before truncation. */
  aliases?: Record<string, string>;
  /** Value used when the source resolves to empty. */
  fallback?: string;
  /**
   * Case-insensitive regex the final value must satisfy. A miss raises the
   * warning W_VALUE_<target> rather than failing the row — used where a value
   * silently changes downstream behaviour (see `campaign` and /rac/i).
   */
  mustMatch?: string;
  /** Explanation surfaced with a mustMatch warning. */
  mustMatchHint?: string;
  /**
   * When set, a value that fails `mustMatch` is PREFIXED with this instead of
   * merely warned about — the repair is applied rather than reported.
   *
   * Preferred over `aliases` for this job because it catches values that cannot
   * be enumerated: LivePerson emits campaigns like "prmsg tWQVPTpxg" where the
   * suffix is a generated id, so next month's export carries a different one and
   * a literal alias list would miss it.
   *
   * The prefix always survives truncation — the value is shortened to fit around
   * it, never the other way round, since losing the prefix would defeat the
   * point.
   */
  prefixWhenUnmatched?: string;
  /**
   * Only populate this field when the named column parses to a number > 0.
   * Used for csatRate, which LivePerson leaves as 0/blank unless csatCount > 0.
   */
  requiresPositive?: string;
}

/** One question/answer column group in a survey block. */
export interface SurveyPairMap {
  question: string;
  answer: string;
  questionId?: string;
  answerId?: string;
  questionType?: string;
  questionFormat?: string;
  /** Label recorded on each emitted answer, e.g. 'pre_chat' | 'post_chat'. */
  block: string;
}

export interface TranscriptMapping {
  /** Primary column holding the whole conversation, e.g. transcriptAll. */
  column: string;
  /** Per-side fallbacks, merged by timestamp when `column` is empty. */
  agentColumn?: string;
  consumerColumn?: string;
  /**
   * Columns whose value may hold the agent's real name. A speaker label that
   * matches one of these is classified as Agent rather than Unknown.
   */
  agentNameColumns: string[];
  /** Speaker labels classified as Agent / Customer / System / Bot. */
  agentLabels: string[];
  customerLabels: string[];
  systemLabels: string[];
  botLabels: string[];
}

export interface CsatMapping {
  /** Value written to interaction_csat.scoreMax. */
  scoreMax: number;
  /** Columns searched in order for a free-text comment. */
  commentColumns: string[];
}

export interface PiiMapping {
  /**
   * Headers dropped before rawJson is built, so they never reach the database.
   * A trailing '*' matches by prefix (e.g. 'customerInfo-*').
   */
  dropColumns: string[];
}

/** Parameters an operator supplies when starting a SQL-source pull. */
export interface SqlSourceParams {
  from: Date;
  to: Date;
  /** The seeded app.clients.key for the chosen Client selector, e.g. 'nmgb'. */
  clientKey: string;
  /** Transcription engine override — only meaningful for call sources. */
  provider?: string;
}

export interface SqlSourceConfig {
  /** Builds the parameterized query text + bind values for one pull. Bind
   *  values only — never string-concatenate an operator-influenced value
   *  into `text`, even though the template itself is developer-authored. */
  buildQuery(params: SqlSourceParams): { text: string; values: unknown[] };
}

export interface SourceMapping {
  key: string;
  label: string;
  version: string;
  /**
   * 'file' (the default when omitted) reads an uploaded/server-inbox file.
   * 'sql' pulls rows via `sql.buildQuery` instead — the frontend's Source
   * tile swaps the file picker for a date-range control accordingly.
   */
  sourceKind?: 'file' | 'sql';
  sql?: SqlSourceConfig;
  /**
   * When set, promote does NOT create a new app.interactions row for this
   * source's rows — it resolves an ALREADY-PROMOTED interaction by matching
   * this staging column against app.interactions, and only inserts into
   * app.interaction_survey. See import-promote.service.ts's attach-mode path.
   */
  attachToExisting?: { matchColumn: 'recordingUrl' };
  /**
   * False when this source has no transcript at all (yet) — e.g. call
   * recordings staged ahead of transcription. Suppresses the
   * no-transcript/unparsed-transcript stage-time errors that otherwise apply
   * to every source. Defaults to true (today's behaviour) when omitted.
   */
  transcriptExpected?: boolean;
  /** 'auto' sniffs the delimiter from the header line. */
  delimiter: 'auto' | ',' | '\t' | ';' | '|';
  /** Disambiguates 01/02/2026 — 'dmy' is the UK house format. */
  dateOrder: 'dmy' | 'mdy' | 'iso';
  /** Separator for LivePerson's multi-value columns (survey Q&A, transfers). */
  multiValueDelimiter: string;
  /**
   * Candidate natural-key columns in preference order. '#1' (positional) is
   * the last resort. The resolved choice is recorded on the import run and is
   * overridable from the UI without re-uploading.
   */
  naturalKeyCandidates: string[];
  fields: FieldMap[];
  transcript: TranscriptMapping;
  csat: CsatMapping;
  /**
   * `pairs` builds a flat SurveyAnswer[] from parallel Q&A columns (see
   * buildSurveyAnswers) — the shape LivePerson's inline post-chat survey needs.
   * `rawJsonColumn` is the alternative for a source whose SQL pull already
   * assembles the final nested answersJson shape itself (e.g. a `FOR JSON
   * PATH` subquery aliased to one column) — that string is carried straight
   * through unchanged, preserving whatever shape existing dashboards already
   * depend on rather than flattening it into the pairs shape. At most one of
   * the two is meaningful for a given source.
   */
  survey: { type: string; pairs: SurveyPairMap[]; rawJsonColumn?: string };
  pii: PiiMapping;
  /** Constants stamped onto every promoted app.interactions row. */
  interactionDefaults: {
    provider: string;
    interactionSource: string;
    interactionType: 'chat' | 'call';
    status: string;
  };
}

/**
 * The canonical staging shape. Field names match app.import_conversations
 * columns, which in turn match their app.* promote targets.
 */
export interface ProjectedRow {
  srcConversationId: string | null;
  srcSessionId: string | null;
  srcInteractionContextId: string | null;

  interactionId: string | null;
  interactionTpsId: string | null;
  interactionDateTime: Date | null;
  campaign: string | null;
  agent: string | null;
  dealer: string | null;
  outcome: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  recordingUrl: string | null;
  maturityDate: Date | null;
  /** Derived in stageRow(), never mapped directly — see maturityDate. */
  daysToMaturityAtInteraction: number | null;

  skill: string | null;
  agentGroup: string | null;
  lob: string | null;
  locationName: string | null;
  durationSeconds: number | null;
  srcMessageCount: number | null;
  srcMessageCountAgent: number | null;
  srcMessageCountConsumer: number | null;
  closeReason: string | null;
  isPartial: boolean | null;
  isTruncated: boolean | null;

  csatScore: number | null;
  csatScoreMax: number | null;
  csatComment: string | null;
  csatRespondedAt: Date | null;
  mcs: number | null;
  alertedMcs: boolean | null;

  surveyType: string | null;
  surveyStatus: string | null;

  transcriptRaw: string | null;
  summaryText: string | null;
}

export type IssueLevel = 'error' | 'warning';

export interface RowIssue {
  level: IssueLevel;
  code: string;
  field?: string;
  message: string;
  /** Pre-truncation value, kept so the UI can show what was lost. */
  original?: string;
  truncatedTo?: number;
}

/** Aggregate verdict for a staged row. Precedence: error > duplicate > existing > warning > valid. */
export type ValidationStatus =
  | 'valid'
  | 'warning'
  | 'error'
  | 'duplicate'
  | 'existing';
