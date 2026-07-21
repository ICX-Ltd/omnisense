import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Human corrections to AI-extracted insight fields. Stored SEPARATELY from the
// insight (the AI value is preserved) so each row is a labelled datapoint: what
// the model produced vs what a reviewer says is correct — golden-set fodder and
// an audit trail. Survives reprocessing.
@Entity({ name: 'insight_corrections', schema: 'app' })
@Index('IX_insight_corrections_recording', ['recordingId'])
export class InsightCorrection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  recordingId!: string;

  // Stable identifier of the field, e.g. 'summary_short',
  // 'qa.right_outcome.q13_vulnerability.answer', 'campaign.consent_to_dealer.answer'.
  @Column({ type: 'varchar', length: 200 })
  fieldKey!: string;

  @Column({ type: 'nvarchar', length: 300 })
  fieldLabel!: string;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  aiValue!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  correctedValue!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  correctedBy!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
