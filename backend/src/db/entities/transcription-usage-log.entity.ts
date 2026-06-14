import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type TranscriptionOutcome = 'success' | 'error';

// One row per transcription attempt. Transcription is priced per audio-MINUTE
// (not tokens), so this is kept separate from llm_usage_log. audioSeconds is the
// provider-reported audio length — available from Deepgram (metadata.duration);
// null for OpenAI gpt-4o-transcribe, which doesn't return it (event-only).
@Entity({ name: 'transcription_usage_log', schema: 'app' })
@Index(['createdAt'])
export class TranscriptionUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier', nullable: true })
  recordingId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  // Provider-reported audio length in seconds. Null when unknown (e.g. OpenAI).
  @Column({ type: 'float', nullable: true })
  audioSeconds!: number | null;

  @Column({ type: 'varchar', length: 16 })
  outcome!: TranscriptionOutcome;

  @CreateDateColumn()
  createdAt!: Date;
}
