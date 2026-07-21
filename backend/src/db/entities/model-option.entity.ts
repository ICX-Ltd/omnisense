import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Editable model lists — the runtime-configurable version of the hardcoded
// insights model dropdowns and the DEEPGRAM_MODEL env var. Add/enable models
// from the UI without a deploy.
//   kind='insights'      — one row per provider option; modelId '' = the
//                          provider's own default model. isDefault marks the
//                          pre-selected dropdown option for that provider.
//   kind='transcription' — available transcription models; the active isDefault
//                          row for provider='deepgram' is what the Deepgram
//                          service uses.
@Entity({ name: 'model_options', schema: 'app' })
export class ModelOption {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: 'insights' | 'transcription';

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ type: 'varchar', length: 120 })
  modelId!: string;

  @Column({ type: 'nvarchar', length: 200 })
  label!: string;

  @Column({ type: 'bit', default: true })
  active!: boolean;

  @Column({ type: 'bit', default: false })
  isDefault!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
