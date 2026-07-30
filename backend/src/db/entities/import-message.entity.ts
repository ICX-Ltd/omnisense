import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * import_messages — the inline transcript split into individual messages during
 * the same parse pass that stages the conversation.
 *
 * These rows are not promoted anywhere: the promoted transcript is the
 * conversation's `transcriptJson`. They exist so the operator can see the parsed
 * chat bubbles, the reconstructed timestamps and any mis-classified speakers
 * BEFORE committing to a promote — which is the whole point of a staging step.
 */
@Entity({ name: 'import_messages', schema: 'app' })
@Index('IX_import_msg_conv', ['conversationStageId', 'seq'])
@Index('IX_import_msg_run', ['importRunId', 'rowNumber'])
export class ImportMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  importRunId!: string;

  /** FK to app.import_conversations(id) ON DELETE CASCADE. */
  @Column({ type: 'uniqueidentifier' })
  conversationStageId!: string;

  /** Parent row number, denormalised so the UI can group without a join. */
  @Column({ type: 'int' })
  rowNumber!: number;

  /** 0-based order within the conversation. */
  @Column({ type: 'int' })
  seq!: number;

  /** Agent | Customer | System | Bot | Unknown — never guessed. */
  @Column({ type: 'varchar', length: 16 })
  source!: string;

  /** Speaker label verbatim from the transcript line. */
  @Column({ type: 'nvarchar', length: 200, nullable: true })
  sender!: string | null;

  /** Clock as printed, e.g. "23:59:30". */
  @Column({ type: 'varchar', length: 40, nullable: true })
  timestampText!: string | null;

  /**
   * Naive-local ISO (no Z, no offset) reconstructed from the conversation start
   * date plus dayOffset. Naive on purpose: the drawer renders via
   * toLocaleTimeString, so a Z suffix would shift every bubble by the viewer's
   * timezone instead of showing the wall-clock the agent saw.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  timestampIso!: string | null;

  /**
   * Days past the conversation start date. Set by the rollover walk, which
   * increments whenever the clock jumps backwards — without it an overnight
   * chat yields negative response times.
   */
  @Column({ type: 'int', default: 0 })
  dayOffset!: number;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  content!: string | null;

  @Column({ type: 'int', nullable: true })
  charCount!: number | null;

  /** Matched a templated automated-nudge pattern. */
  @Column({ type: 'bit', nullable: true })
  isAuto!: boolean | null;

  /** Matched the bot/human handover marker. */
  @Column({ type: 'bit', nullable: true })
  isHandover!: boolean | null;

  /**
   * False for Unknown speakers: staged and visible, but left out of the promoted
   * transcript so they cannot be mis-attributed into the response-time metrics.
   */
  @Column({ type: 'bit', default: true })
  includedInTranscript!: boolean;

  @Column({ type: 'varchar', length: 200, nullable: true })
  parseWarning!: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;
}
