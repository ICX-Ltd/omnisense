import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RecordingStatus =
  | 'pending_transcription'
  | 'transcribing'
  | 'transcribed'
  | 'insights_pending'
  | 'insights_done'
  | 'error';

@Entity({ name: 'interactions', schema: 'app' })
export class Interaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, default: 'telnyx' })
  provider!: string; // telnyx | thirdparty | manual

  @Column({ type: 'varchar', length: 2048, nullable: true })
  recordingUrl!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  storageKey!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'pending_transcription' })
  status!: RecordingStatus;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  lastError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'varchar', length: 32, nullable: true })
  interactionSource!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  interactionType!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  interactionId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  interactionTpsId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  campaign!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  agent!: string | null;

  @Column({ type: 'datetime2', nullable: true })
  interactionDateTime!: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  outcome!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  vehicleMake!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  vehicleModel!: string | null;

  // Persisted computed column: COALESCE(interactionDateTime, createdAt)
  // Created by sql/create-indexes.sql — do not set manually
  @Column({ type: 'datetime2', nullable: true, insert: false, update: false })
  effectiveDate!: Date | null;

  // End-date of the customer's finance agreement. Imported from upstream CRM.
  @Column({ type: 'datetime2', nullable: true })
  maturityDate!: Date | null;

  // Days between the interaction and the agreement maturity, snapshotted at
  // the time of the interaction. Stable for trend analysis — does not move
  // forward with the calendar. Auto-populated by the hook below when both
  // maturityDate and interactionDateTime/createdAt are present.
  @Column({ type: 'int', nullable: true })
  daysToMaturityAtInteraction!: number | null;

  @BeforeInsert()
  @BeforeUpdate()
  private computeDaysToMaturity() {
    if (!this.maturityDate) {
      this.daysToMaturityAtInteraction = null;
      return;
    }
    const anchor = this.interactionDateTime ?? this.createdAt ?? null;
    if (!anchor) {
      this.daysToMaturityAtInteraction = null;
      return;
    }
    const ms = this.maturityDate.getTime() - anchor.getTime();
    this.daysToMaturityAtInteraction = Math.floor(ms / 86_400_000);
  }
}
