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

  // Token usage for cost tracking. Successful-attempt tokens, attempt count, and
  // tokens burned on failed attempts (retry waste). Populated by generateInsights.
  @Column({ type: 'int', nullable: true })
  insight_input_tokens!: number | null;

  @Column({ type: 'int', nullable: true })
  insight_output_tokens!: number | null;

  @Column({ type: 'int', nullable: true })
  insight_attempts!: number | null;

  @Column({ type: 'int', nullable: true })
  insight_failed_input_tokens!: number | null;

  @Column({ type: 'int', nullable: true })
  insight_failed_output_tokens!: number | null;

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

  // Scoring flags — true when operations.scoring_flags surfaces a concern.
  // Indexed for fast filter/count on the dashboards.
  @Index()
  @Column({ type: 'bit', nullable: true })
  operations_partial_scoring!: boolean | null;

  @Index()
  @Column({ type: 'bit', nullable: true })
  operations_low_score_alert!: boolean | null;

  @Index()
  @Column({ type: 'bit', nullable: true })
  qa_partial_scoring!: boolean | null;

  @Index()
  @Column({ type: 'bit', nullable: true })
  qa_low_score_alert!: boolean | null;

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

  // ── Objection handling assessment (campaign-specific) ───────────────────

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  objection_assessments_json!: string | null;

  // ── Chat response time metrics ───────────────────────────────────────────
  // Populated only for chats (transcripts with per-message timestamps).
  // Auto-messages (idle prompts) are excluded from these measurements.

  @Column({ type: 'float', nullable: true })
  chat_response_avg_seconds!: number | null;

  @Column({ type: 'float', nullable: true })
  chat_response_longest_seconds!: number | null;

  @Column({ type: 'float', nullable: true })
  chat_response_last_seconds!: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  chat_response_sla_breach_count!: number | null;

  @Column({ type: 'int', nullable: true })
  chat_response_measured_count!: number | null;

  // Full per-turn pair list (customer→agent gaps with is_auto_message flag).
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  chat_response_metrics_json!: string | null;

  // ── Opportunity classification ───────────────────────────────────────────

  @Index()
  @Column({ type: 'bit', nullable: true })
  is_opportunity!: boolean | null;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  not_opportunity_reason!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  opportunity_json!: string | null;

  // ── Campaign-specific Q&A (e.g. Parity) ─────────────────────────────────
  // Structured answers to a per-campaign question set. The shape is defined
  // by the campaign's prompt fragment (call.campaign.<name>.qa_schema), so
  // this column is intentionally schemaless from the database's point of view.

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  campaign_answers_json!: string | null;

  // ── Campaign-specific transcript insights (e.g. NMGB Survey) ─────────────
  // A SECOND campaign blob, separate from campaign_answers_json. Needed because
  // for NMGB Survey campaign_answers_json is owned by the survey feed backfill
  // (sql/nmgb_survey_backfill.sql) and is nulled/restored around each LLM run;
  // transcript-derived insights would be clobbered if they shared that column.
  // This column is only written by the LLM and is left untouched by the backfill.
  // Shape is defined by the campaign's call.campaign.<name>.transcript_schema
  // fragment, so it is intentionally schemaless from the database's view.
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  campaign_transcript_json!: string | null;

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
