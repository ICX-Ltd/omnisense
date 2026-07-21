import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Editable transcription vocabulary — the runtime-configurable version of
// VEHICLE_KEYTERMS / VEHICLE_REPLACEMENTS (which now seed this table). Editing
// these no longer needs a code deploy.
//   kind='keyterm'     → term = the make/model to bias toward
//   kind='replacement' → term = the mis-heard word, replaceWith = the correction
@Entity({ name: 'transcription_vocab', schema: 'app' })
export class TranscriptionVocab {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: 'keyterm' | 'replacement';

  @Column({ type: 'nvarchar', length: 200 })
  term!: string;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  replaceWith!: string | null;

  @Column({ type: 'bit', default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
