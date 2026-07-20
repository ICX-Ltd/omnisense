import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Interaction } from './interaction.entity';

@Entity({ name: 'interaction_transcripts', schema: 'app' })
export class InteractionTranscript {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Interaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recordingId' })
  recording!: Interaction;

  @Column({ type: 'uniqueidentifier' })
  recordingId!: string;

  @Column({ type: 'nvarchar', length: 'MAX' })
  text!: string;

  @Column({ type: 'varchar', length: 100, default: 'gpt-4o-transcribe' })
  model!: string;

  // Overall transcription confidence 0–1 (Deepgram alternative confidence).
  // Null for providers that don't report it (e.g. gpt-4o-transcribe).
  @Column({ type: 'float', nullable: true })
  confidence!: number | null;

  // JSON array of the least-confident words: [{ word, confidence, count }].
  // Feeds the drawer spot-check view + the vehicle keyterm-suggestion loop.
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  lowConfidenceJson!: string | null;

  // Semantic-search vector: JSON array of floats (OpenAI text-embedding-3-small,
  // 512 dims). Null until the embed batch runs.
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  embedding!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  embeddingModel!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
