import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type LlmAttemptOutcome =
  | 'success'
  | 'invalid_json'
  | 'truncated'
  | 'empty';

// One row per LLM extraction ATTEMPT (success or failure), so total spend —
// including fully-failed records that never produce an interaction_insights row —
// is captured. The per-record columns on interaction_insights cover "what landed";
// this table covers "what was actually spent".
@Entity({ name: 'llm_usage_log', schema: 'app' })
@Index(['createdAt'])
export class LlmUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier', nullable: true })
  recordingId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  interactionType!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  campaign!: string | null;

  // 1-based attempt index within a single extraction (1 = first try).
  @Column({ type: 'int', default: 1 })
  attempt!: number;

  @Column({ type: 'varchar', length: 16 })
  outcome!: LlmAttemptOutcome;

  @Column({ type: 'bit', default: false })
  truncated!: boolean;

  @Column({ type: 'int', default: 0 })
  inputTokens!: number;

  @Column({ type: 'int', default: 0 })
  outputTokens!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
