import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Lifecycle of an import run. Also the guard on every mutating endpoint. */
export type ImportRunStatus =
  | 'parsing'
  | 'staged'
  | 'parse_failed'
  | 'promoting'
  | 'promoted'
  | 'promote_failed'
  | 'rolled_back';

export type ImportIntake = 'upload' | 'server';

/**
 * import_runs — one row per file load.
 *
 * The header of a three-table staging area (runs -> conversations -> messages,
 * cascading on delete). It carries everything needed to explain, re-run or undo
 * a load: which mapping version ran, what the sniffer decided, how the columns
 * resolved, and the counts at each stage.
 *
 * Column rule: the JSON blobs (headerJson, mappedColumnsJson, ...) are the
 * source of truth for the mapping report; dedicated columns exist only where
 * the UI filters or sorts on them (status, createdAt, fileSha256).
 */
@Entity({ name: 'import_runs', schema: 'app' })
export class ImportRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Mapping key, e.g. 'liveperson'. */
  @Column({ type: 'varchar', length: 50 })
  sourceKey!: string;

  /** Mapping config version in force when this run was staged. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  mappingVersion!: string | null;

  @Column({ type: 'varchar', length: 16 })
  intake!: ImportIntake;

  /**
   * Client this run's interactions belong to — stamped once here and copied
   * onto every app.interactions row the promote step creates (see
   * import-promote.service.ts), the same way sourceKey becomes
   * interactionSource. Nullable only for parity with app.interactions.clientId;
   * the UI requires a selection before staging can start.
   */
  @Column({ type: 'uniqueidentifier', nullable: true })
  clientId!: string | null;

  @Column({ type: 'nvarchar', length: 400, nullable: true })
  originalFilename!: string | null;

  @Column({ type: 'nvarchar', length: 1024, nullable: true })
  serverPath!: string | null;

  @Column({ type: 'bigint', nullable: true })
  fileSizeBytes!: number | null;

  /** Spots the same file being imported twice. */
  @Index('IX_import_runs_sha')
  @Column({ type: 'char', length: 64, nullable: true })
  fileSha256!: string | null;

  // ── what the sniffer decided ─────────────────────────────────────────────
  @Column({ type: 'varchar', length: 10, nullable: true })
  delimiter!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  encoding!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  headerJson!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  mappedColumnsJson!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  unmappedColumnsJson!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  missingColumnsJson!: string | null;

  /**
   * Resolved conversation-id column. Overridable from the UI, which re-derives
   * the keys from rawJson without needing the file again.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  naturalKeyColumn!: string | null;

  @Index('IX_import_runs_status_created')
  @Column({ type: 'varchar', length: 24, default: 'parsing' })
  status!: ImportRunStatus;

  // ── staging counts ───────────────────────────────────────────────────────
  @Column({ type: 'int', nullable: true })
  rowsRead!: number | null;

  @Column({ type: 'int', nullable: true })
  rowsStaged!: number | null;

  /** Records csv-parse could not read at all. */
  @Column({ type: 'int', nullable: true })
  rowsSkipped!: number | null;

  @Column({ type: 'int', nullable: true })
  rowsValid!: number | null;

  @Column({ type: 'int', nullable: true })
  rowsWarning!: number | null;

  @Column({ type: 'int', nullable: true })
  rowsError!: number | null;

  @Column({ type: 'int', nullable: true })
  rowsDuplicate!: number | null;

  /** Already present in app.interactions, or promoted by an earlier run. */
  @Column({ type: 'int', nullable: true })
  rowsExisting!: number | null;

  @Column({ type: 'int', nullable: true })
  rowsExcluded!: number | null;

  @Column({ type: 'int', nullable: true })
  messagesStaged!: number | null;

  @Column({ type: 'int', nullable: true })
  transcriptsParsed!: number | null;

  @Column({ type: 'int', nullable: true })
  transcriptsPartial!: number | null;

  @Column({ type: 'int', nullable: true })
  transcriptsFailed!: number | null;

  // ── promote counts ───────────────────────────────────────────────────────
  @Column({ type: 'int', nullable: true })
  promotedInteractions!: number | null;

  @Column({ type: 'int', nullable: true })
  promotedTranscripts!: number | null;

  @Column({ type: 'int', nullable: true })
  promotedCsat!: number | null;

  @Column({ type: 'int', nullable: true })
  promotedSurveys!: number | null;

  @Column({ type: 'int', nullable: true })
  promoteSkipped!: number | null;

  // ── job tracking (app.batch_jobs) ────────────────────────────────────────
  @Column({ type: 'uniqueidentifier', nullable: true })
  parseJobId!: string | null;

  @Column({ type: 'uniqueidentifier', nullable: true })
  promoteJobId!: string | null;

  @Column({ type: 'nvarchar', length: 2000, nullable: true })
  lastError!: string | null;

  @Column({ type: 'nvarchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'datetime2', nullable: true })
  stagedAt!: Date | null;

  @Column({ type: 'datetime2', nullable: true })
  promotedAt!: Date | null;

  @Column({ type: 'datetime2', nullable: true })
  rolledBackAt!: Date | null;

  /** Set when staging rows are purged but the audit header is kept. */
  @Column({ type: 'datetime2', nullable: true })
  purgedAt!: Date | null;
}
