import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Aggregate verdict. Precedence: error > duplicate > existing > warning > valid. */
export type ImportValidationStatus =
  | 'pending'
  | 'valid'
  | 'warning'
  | 'error'
  | 'duplicate'
  | 'existing';

export type ImportPromoteStatus = 'pending' | 'promoted' | 'skipped' | 'failed';

/**
 * import_conversations — one staged row per source conversation.
 *
 * Columns are named after their app.* PROMOTE TARGETS rather than the provider's
 * headers, which is what makes promote a 1:1 INSERT ... SELECT and lets a second
 * provider be added as a mapping instead of a schema change. The complete source
 * row survives in `rawJson`, minus whatever the PII policy drops.
 *
 * All normalisation and truncation happens at STAGE time, never at promote time,
 * so what the operator eyeballs is exactly what will land.
 */
@Entity({ name: 'import_conversations', schema: 'app' })
@Index('IX_import_conv_run_row', ['importRunId', 'rowNumber'], { unique: true })
@Index('IX_import_conv_run_status', ['importRunId', 'validationStatus'])
@Index('IX_import_conv_srckey', ['sourceKey', 'srcConversationId'])
@Index('IX_import_conv_promote', ['importRunId', 'promoteStatus'])
export class ImportConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to app.import_runs(id) ON DELETE CASCADE — discarding a run cleans up. */
  @Column({ type: 'uniqueidentifier' })
  importRunId!: string;

  /** 1-based data row in the file (the header is not counted). */
  @Column({ type: 'int' })
  rowNumber!: number;

  @Column({ type: 'varchar', length: 50 })
  sourceKey!: string;

  // ── source identity, full length, for QA ─────────────────────────────────
  @Column({ type: 'varchar', length: 200, nullable: true })
  srcConversationId!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  srcSessionId!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  srcInteractionContextId!: string | null;

  // ── canonical projection of app.interactions ─────────────────────────────
  @Index('IX_import_conv_interactionId')
  @Column({ type: 'varchar', length: 50, nullable: true })
  interactionId!: string | null;

  /** CSAT match key. Same value as interactionId: LivePerson has no separate ref. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  interactionTpsId!: string | null;

  @Column({ type: 'datetime2', nullable: true })
  interactionDateTime!: Date | null;

  /**
   * Must contain "RAC" for the chat insights prompt to apply the RAC QA
   * assessment (isRacCampaign in insights/prompt/build-insights-prompt.ts).
   * A miss raises W_VALUE_campaign at stage time.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  campaign!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  agent!: string | null;

  /** Unmapped for the RAC-level LivePerson feed; present for future sources. */
  @Column({ type: 'nvarchar', length: 200, nullable: true })
  dealer!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  outcome!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  vehicleMake!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  vehicleModel!: string | null;

  // ── QA-only: never promoted, but filterable in the eyeball grid ──────────
  @Column({ type: 'nvarchar', length: 200, nullable: true })
  skill!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  agentGroup!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  lob!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  locationName!: string | null;

  @Column({ type: 'int', nullable: true })
  durationSeconds!: number | null;

  @Column({ type: 'int', nullable: true })
  srcMessageCount!: number | null;

  @Column({ type: 'int', nullable: true })
  srcMessageCountAgent!: number | null;

  @Column({ type: 'int', nullable: true })
  srcMessageCountConsumer!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  closeReason!: string | null;

  @Column({ type: 'bit', nullable: true })
  isPartial!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  isTruncated!: boolean | null;

  // ── CSAT / quality ───────────────────────────────────────────────────────
  /** From csatRate — the customer-stated score, gated on csatCount > 0. */
  @Column({ type: 'int', nullable: true })
  csatScore!: number | null;

  @Column({ type: 'int', nullable: true })
  csatScoreMax!: number | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  csatComment!: string | null;

  @Column({ type: 'datetime2', nullable: true })
  csatRespondedAt!: Date | null;

  /** LivePerson's own sentiment score — kept for analysis, never used as CSAT. */
  @Column({ type: 'int', nullable: true })
  mcs!: number | null;

  @Column({ type: 'bit', nullable: true })
  alertedMcs!: boolean | null;

  // ── survey ───────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 50, nullable: true })
  surveyType!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  surveyStatus!: string | null;

  /** [{block,question,answer,questionId,answerId,...}] -> interaction_survey. */
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  surveyAnswersJson!: string | null;

  // ── content ──────────────────────────────────────────────────────────────
  /** The provider's transcript column, verbatim. */
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  transcriptRaw!: string | null;

  /**
   * Normalised message array, the value promoted to
   * interaction_transcripts.text. Shape is understood by both
   * parseChatTranscript and InteractionDetailDrawer.
   */
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  transcriptJson!: string | null;

  @Column({ type: 'int', nullable: true })
  transcriptMessageCount!: number | null;

  /** parsed | partial | unparsed | empty */
  @Column({ type: 'varchar', length: 20, nullable: true })
  transcriptParseStatus!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  summaryText!: string | null;

  // ── provenance / QA ──────────────────────────────────────────────────────
  /** Whole source row keyed by header, PII columns already removed. */
  @Column({ type: 'nvarchar', length: 'MAX' })
  rawJson!: string;

  @Column({ type: 'bit', default: false })
  piiRedacted!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  validationStatus!: ImportValidationStatus;

  /** [{level,code,field,message,original,truncatedTo}] */
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  validationJson!: string | null;

  @Column({ type: 'bit', default: false })
  excluded!: boolean;

  @Column({ type: 'nvarchar', length: 400, nullable: true })
  excludedReason!: string | null;

  /**
   * NULL means the machine excluded this row, so revalidate may clear it.
   * Non-NULL means a human did, and revalidate must preserve that.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  excludedBy!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  promoteStatus!: ImportPromoteStatus;

  /**
   * Pre-generated id, claimed before the promote insert so child rows can join
   * without a round trip and a re-promote becomes a no-op.
   */
  @Column({ type: 'uniqueidentifier', nullable: true })
  promotedInteractionId!: string | null;

  @Column({ type: 'nvarchar', length: 1024, nullable: true })
  promoteError!: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;
}
