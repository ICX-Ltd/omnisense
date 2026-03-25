import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type BatchJobType = 'transcribe' | 'insights_calls' | 'insights_chats';
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
