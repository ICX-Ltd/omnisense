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

  @CreateDateColumn()
  createdAt!: Date;
}
