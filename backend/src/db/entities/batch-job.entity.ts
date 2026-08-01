import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type BatchJobType =
  | 'transcribe'
  | 'insights_calls'
  | 'insights_chats'
  // Data importer. import_parse streams a file into staging (its `total` is
  // unknown until the stream ends, so progress is a row counter, not a
  // percentage); import_promote has a real total up front.
  | 'import_parse'
  | 'import_promote'
  // CSAT contest assessment. Was run synchronously inside the HTTP request,
  // which capped a run at whatever the proxy timeout allowed (~25 records).
  // A bulk import produces hundreds at once, so it needs the background pattern.
  | 'csat_assess';
export type BatchJobStatus = 'running' | 'completed' | 'failed';

@Entity({ name: 'batch_jobs', schema: 'app' })
export class BatchJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: BatchJobType;

  @Column({ type: 'varchar', length: 16, default: 'running' })
  status!: BatchJobStatus;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ type: 'int', default: 0 })
  total!: number;

  @Column({ type: 'int', default: 0 })
  errorCount!: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  provider!: string | null;

  // JSON array of { id: string, error: string } — last 50 errors from this job
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  errorsJson!: string | null;

  @CreateDateColumn()
  startedAt!: Date;

  @Column({ type: 'datetime2', nullable: true })
  completedAt!: Date | null;
}
