import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Interaction } from './interaction.entity';

@Entity({ name: 'interaction_insights', schema: 'app' })
export class InteractionInsight {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Interaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recordingId' })
  recording!: Interaction;

  @Column({ type: 'uniqueidentifier' })
  recordingId!: string;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  providerUsed!: string | null;

  @Column({ type: 'nvarchar', length: 120, nullable: true })
  model!: string | null;

  // Full raw JSON from the LLM — never strip this
  @Column({ type: 'nvarchar', length: 'MAX' })
  json!: string;

  @Column({ type: 'varchar', length: 50, default: 'v3' })
  extractorVersion!: string;

  @CreateDateColumn()
  createdAt!: Date;

  // ── Shared scalar fields ─────────────────────────────────────────────────

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  contact_disposition!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  conversation_type!: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  summary_short!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  summary_detailed!: string | null;

  @Column({ type: 'float', nullable: true })
  sentiment_overall!: number | null;

  // ── Customer signals ─────────────────────────────────────────────────────

  @Index()
  @Column({ type: 'varchar', length: 20, nullable: true })
  interest_level!: string | null; // high | medium | low | unknown

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  decision_timeline!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  next_step_agreed!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  objections_json!: string | null; // string[]

  // ── Operations ───────────────────────────────────────────────────────────

  @Column({ type: 'float', nullable: true })
  overall_score!: number | null; // operations.overall_score

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  operations_scores_json!: string | null; // all dimension score objects

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  coaching_json!: string | null; // { did_well, needs_improvement, good_quotes, bad_quotes }

  // ── Call-specific ────────────────────────────────────────────────────────

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  campaign_detected!: string | null; // null for chats

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  campaign_compliance_json!: string | null; // null for chats

  // ── Client services (scalar) ─────────────────────────────────────────────

  @Column({ type: 'bit', nullable: true })
  is_in_market_now!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  has_purchased_elsewhere!: boolean | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  competitor_purchased!: string | null;

  @Column({ type: 'bit', nullable: true })
  lost_sale!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  lead_generated_for_dealer!: boolean | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  dealer_name!: string | null;

  // Full client_services blob (includes blockers + competitor_intelligence)
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  client_services_json!: string | null;

  // ── QA assessment (campaign-specific Q&A scoring) ────────────────────────

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  qa_scores_json!: string | null;

  // ── Opportunity classification ───────────────────────────────────────────

  @Index()
  @Column({ type: 'bit', nullable: true })
  is_opportunity!: boolean | null;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  not_opportunity_reason!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  opportunity_json!: string | null;

  // ── Shared JSON fields ───────────────────────────────────────────────────

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  action_items_json!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  key_entities_json!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  risk_flags_json!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  data_quality_json!: string | null;
}
