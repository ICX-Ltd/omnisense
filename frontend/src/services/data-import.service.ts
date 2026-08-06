// Client for the data importer.
//
// Uses the shared `api` axios instance rather than raw axios: it attaches the
// JWT and handles 401 refresh. The importer endpoints are role-gated server
// side, so a bare axios call would start 401ing as soon as the token rotated.

import api from "./api";
import { ApiPath } from "../enums/api";

export type ValidationStatus =
  | "pending"
  | "valid"
  | "warning"
  | "error"
  | "duplicate"
  | "existing";

export type RunStatus =
  | "parsing"
  | "staged"
  | "parse_failed"
  | "promoting"
  | "promoted"
  | "promote_failed"
  | "rolled_back";

export interface SourceInfo {
  key: string;
  label: string;
  version: string;
  /** 'sql' sources pull via a date-range query instead of a file. */
  sourceKind: "file" | "sql";
  delimiter: string;
  dateOrder: string;
  naturalKeyCandidates: string[];
  expectedColumns: number;
  interactionDefaults: {
    provider: string;
    interactionSource: string;
    interactionType: string;
    status: string;
  };
  piiDropColumns: string[];
  targetFields: Array<{
    target: string;
    columns: string[];
    const: string | number | null;
    maxLength: number | null;
    hardKey: boolean;
  }>;
}

export interface ServerFile {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface RowIssue {
  level: "error" | "warning";
  code: string;
  field?: string;
  message: string;
  original?: string;
  truncatedTo?: number;
}

export interface PreviewMessage {
  seq: number;
  source: string;
  sender: string;
  timestampIso: string | null;
  dayOffset: number;
  included: boolean;
  contentPreview: string;
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
  messages: PreviewMessage[];
}

export interface PreviewResult {
  sourceKey: string;
  sourceLabel: string;
  mappingVersion: string;
  file: { name: string; sizeBytes: number | null; intake: "upload" | "server" };
  encoding: string;
  delimiter: string;
  delimiterLabel: string;
  delimiterCounts: Record<string, number>;
  headerColumnCount: number;
  headers: string[];
  naturalKeyColumn: string | null;
  naturalKeyColumnLabel: string | null;
  columnMapping: {
    mapped: Array<{ target: string; column: string }>;
    missing: Array<{ target: string; columns: string[] }>;
    unmapped: string[];
    droppedByPolicy: string[];
  };
  rowsRead: number;
  truncated: boolean;
  issueCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  transcriptStatusCounts: Record<string, number>;
  duplicateKeysInSample: string[];
  skipped: Array<{ rowNumber: number | null; message: string }>;
  sampleRows: PreviewSampleRow[];
}

export interface RunCounts {
  read: number;
  staged: number;
  skipped: number;
  valid: number;
  warning: number;
  error: number;
  duplicate: number;
  existing: number;
  excluded: number;
  messages: number;
  transcriptsParsed: number;
  transcriptsPartial: number;
  transcriptsFailed: number;
}

export interface ImportRunSummary {
  id: string;
  sourceKey: string;
  clientId: string | null;
  mappingVersion: string | null;
  intake: "upload" | "server";
  originalFilename: string | null;
  fileSizeBytes: number | null;
  delimiter: string | null;
  encoding: string | null;
  status: RunStatus;
  naturalKeyColumn: string | null;
  naturalKeyColumnLabel: string | null;
  counts: RunCounts;
  promoted: {
    interactions: number;
    transcripts: number;
    csat: number;
    surveys: number;
    skipped: number;
  };
  parseJobId: string | null;
  promoteJobId: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string | null;
  stagedAt: string | null;
  promotedAt: string | null;
  rolledBackAt: string | null;
  purgedAt: string | null;
}

export interface ImportRunDetail extends ImportRunSummary {
  headers: string[];
  headerColumnCount: number;
  mappedColumns: unknown[];
  unmappedColumns: unknown[];
  missingColumns: unknown[];
}

export interface StagedRowSummary {
  rowNumber: number;
  validationStatus: ValidationStatus;
  excluded: boolean;
  excludedReason: string | null;
  excludedByOperator: boolean;
  promoteStatus: string;
  promotedInteractionId: string | null;
  promoteError: string | null;
  conversationId: string | null;
  sessionId: string | null;
  interactionId: string | null;
  interactionDateTime: string | null;
  campaign: string | null;
  agent: string | null;
  skill: string | null;
  outcome: string | null;
  durationSeconds: number | null;
  csatScore: number | null;
  csatScoreMax: number | null;
  mcs: number | null;
  transcriptParseStatus: string | null;
  transcriptMessageCount: number | null;
  isPartial: boolean | null;
  isTruncated: boolean | null;
  errorCount: number;
  warningCount: number;
  issueCodes: string[];
}

export interface StagedRowDetail extends StagedRowSummary {
  issues: RowIssue[];
  transcriptRaw: string | null;
  transcriptJson: string | null;
  summaryText: string | null;
  surveyAnswers: Array<{
    block: string;
    question: string;
    answer: string;
    questionId?: string;
    answerId?: string;
  }>;
  messages: Array<{
    seq: number;
    source: string;
    sender: string | null;
    timestampText: string | null;
    timestampIso: string | null;
    dayOffset: number;
    content: string | null;
    isAuto: boolean | null;
    isHandover: boolean | null;
    includedInTranscript: boolean;
    parseWarning: string | null;
  }>;
  raw: Record<string, string>;
  /** Headers removed by the PII policy — never stored. */
  droppedByPolicy: string[];
  /** Headers present in the file but empty, so not kept in rawJson. */
  emptyColumnCount: number;
}

export interface RowsPage {
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
  rows: StagedRowSummary[];
}

export interface StartRunResult {
  runId: string;
  jobId: string;
  fileSizeBytes: number | null;
  /** Set when a file with the same SHA-256 was imported before. */
  duplicateOfRunId: string | null;
}

export async function listSources(): Promise<SourceInfo[]> {
  const { data } = await api.get<SourceInfo[]>(ApiPath.DataImportSources);
  return data;
}

export async function listServerFiles(): Promise<ServerFile[]> {
  const { data } = await api.get<ServerFile[]>(ApiPath.DataImportServerFiles);
  return data;
}

// Metadata goes in the query string, not as extra form fields: the backend's
// global ValidationPipe uses forbidNonWhitelisted and would 400 them.
export async function previewUpload(
  file: File,
  sourceKey: string,
  naturalKeyColumn?: string,
  onProgress?: (percent: number) => void,
): Promise<PreviewResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<PreviewResult>(ApiPath.DataImportPreview, form, {
    params: { sourceKey, naturalKeyColumn },
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

export async function previewServerFile(
  fileName: string,
  sourceKey: string,
  naturalKeyColumn?: string,
): Promise<PreviewResult> {
  const { data } = await api.get<PreviewResult>(ApiPath.DataImportPreviewServer, {
    params: { sourceKey, file: fileName, naturalKeyColumn },
  });
  return data;
}

export async function stageUpload(
  file: File,
  sourceKey: string,
  clientId: string,
  naturalKeyColumn?: string,
  onProgress?: (percent: number) => void,
): Promise<StartRunResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<StartRunResult>(
    ApiPath.DataImportStageUpload,
    form,
    {
      params: { sourceKey, clientId, naturalKeyColumn },
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    },
  );
  return data;
}

export async function stageServerFile(
  fileName: string,
  sourceKey: string,
  clientId: string,
  naturalKeyColumn?: string,
): Promise<StartRunResult> {
  const { data } = await api.post<StartRunResult>(
    ApiPath.DataImportStageServer,
    null,
    { params: { sourceKey, file: fileName, clientId, naturalKeyColumn } },
  );
  return data;
}

export interface StartSqlRunResult {
  runId: string;
  jobId: string;
  rowsPulled: number;
}

/** Stages a SQL-source pull (e.g. ICX call-centre calls/survey) for a date range. */
export async function stageSql(
  sourceKey: string,
  clientId: string,
  from: string,
  to: string,
): Promise<StartSqlRunResult> {
  const { data } = await api.post<StartSqlRunResult>(
    ApiPath.DataImportStageSql,
    null,
    { params: { sourceKey, clientId, from, to } },
  );
  return data;
}

export async function listRuns(limit = 25): Promise<ImportRunSummary[]> {
  const { data } = await api.get<ImportRunSummary[]>(ApiPath.DataImportRuns, {
    params: { limit },
  });
  return data;
}

export async function getRun(runId: string): Promise<ImportRunDetail> {
  const { data } = await api.get<ImportRunDetail>(
    `${ApiPath.DataImportRuns}/${runId}`,
  );
  return data;
}

export async function listRows(
  runId: string,
  params: {
    status?: string;
    onlyIssues?: boolean;
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<RowsPage> {
  const { data } = await api.get<RowsPage>(
    `${ApiPath.DataImportRuns}/${runId}/rows`,
    { params },
  );
  return data;
}

export async function getRowDetail(
  runId: string,
  rowNumber: number,
): Promise<StagedRowDetail> {
  const { data } = await api.get<StagedRowDetail>(
    `${ApiPath.DataImportRuns}/${runId}/rows/${rowNumber}`,
  );
  return data;
}

export async function setRowExcluded(
  runId: string,
  rowNumber: number,
  excluded: boolean,
  reason?: string,
): Promise<void> {
  await api.patch(`${ApiPath.DataImportRuns}/${runId}/rows/${rowNumber}`, {
    excluded,
    reason,
  });
}

export async function excludeByStatus(
  runId: string,
  statuses: string[],
  reason?: string,
): Promise<{ excluded: number }> {
  const { data } = await api.post<{ excluded: number }>(
    `${ApiPath.DataImportRuns}/${runId}/exclude`,
    { statuses, reason },
  );
  return data;
}

export async function rekeyRun(
  runId: string,
  naturalKeyColumn: string,
): Promise<{ updated: number }> {
  const { data } = await api.post<{ updated: number }>(
    `${ApiPath.DataImportRuns}/${runId}/rekey`,
    { naturalKeyColumn },
  );
  return data;
}

export async function revalidateRun(runId: string): Promise<ImportRunDetail> {
  const { data } = await api.post<ImportRunDetail>(
    `${ApiPath.DataImportRuns}/${runId}/revalidate`,
  );
  return data;
}

export async function discardRun(runId: string): Promise<void> {
  await api.delete(`${ApiPath.DataImportRuns}/${runId}`);
}

export interface PromotePreview {
  runId: string;
  promotable: number;
  alreadyPromoted: number;
  excluded: number;
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
  csatCreatedByImport: number;
  csatPreExisting: number;
  surveysAffected: number;
}

export async function getPromotePreview(runId: string): Promise<PromotePreview> {
  const { data } = await api.get<PromotePreview>(
    `${ApiPath.DataImportRuns}/${runId}/promote-preview`,
  );
  return data;
}

export async function promoteRun(
  runId: string,
): Promise<{ jobId: string; total: number }> {
  const { data } = await api.post<{ jobId: string; total: number }>(
    `${ApiPath.DataImportRuns}/${runId}/promote`,
  );
  return data;
}

export async function getRollbackPreview(
  runId: string,
): Promise<RollbackPreview> {
  const { data } = await api.get<RollbackPreview>(
    `${ApiPath.DataImportRuns}/${runId}/rollback-preview`,
  );
  return data;
}

/** `confirm` must be `ROLLBACK <first 8 chars of the run id>`. */
export async function rollbackRun(
  runId: string,
  confirm: string,
): Promise<{
  interactionsDeleted: number;
  csatDeleted: number;
  csatUnlinked: number;
  surveysDeleted: number;
}> {
  const { data } = await api.post(
    `${ApiPath.DataImportRuns}/${runId}/rollback`,
    { confirm },
  );
  return data;
}

export async function getDedupeReport(): Promise<{
  duplicateGroups: number;
  rows: Array<{
    interactionSource: string;
    interactionId: string;
    count: number;
    firstSeen: string | null;
  }>;
}> {
  const { data } = await api.get(ApiPath.DataImportDedupeReport);
  return data;
}

export async function purgeStaging(runId: string): Promise<{ purged: number }> {
  const { data } = await api.post<{ purged: number }>(
    `${ApiPath.DataImportRuns}/${runId}/purge-staging`,
  );
  return data;
}

/** Job progress, via the existing recordings job endpoint. */
export async function getJob(jobId: string): Promise<{
  id: string;
  type: string;
  status: string;
  progress: number;
  total: number;
  errorCount: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  const { data } = await api.get(`${ApiPath.Recordings}/jobs/${jobId}`);
  return data;
}

export function prettyBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
