import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'survey_responses', schema: 'app' })
export class SurveyResponse {
  @PrimaryColumn({ type: 'int' })
  id_opportunity!: number;

  // ── Context ─────────────────────────────────────────────────────────────────

  @Index()
  @Column({ type: 'nvarchar', length: 200, nullable: true })
  campaign!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  sub_campaign!: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  manufacture!: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 200, nullable: true })
  model!: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 200, nullable: true })
  dealer!: string | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  dealer_code!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  prospect_type!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  source_type!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  product_type!: string | null;

  // ── Outcome / Result ────────────────────────────────────────────────────────

  @Index()
  @Column({ type: 'nvarchar', length: 200, nullable: true })
  result_code_desc!: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  category!: string | null;

  @Column({ type: 'int', nullable: true })
  outcome!: number | null;

  @Column({ type: 'bit', nullable: true })
  positive_outcome!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  neutral_outcome!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  negative_outcome!: boolean | null;

  // ── Dates ───────────────────────────────────────────────────────────────────

  @Index()
  @Column({ type: 'datetime', nullable: true })
  allocation_date!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  first_attempt_date!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  last_attempt_date!: Date | null;

  @Column({ type: 'date', nullable: true })
  fpi_date!: Date | null;

  // ── Agent ───────────────────────────────────────────────────────────────────

  @Index()
  @Column({ type: 'int', nullable: true })
  id_agent!: number | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  result_code_plan!: string | null;

  // ── Call info ───────────────────────────────────────────────────────────────

  @Column({ type: 'int', default: 0 })
  total_attempts!: number;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  call_recording_url!: string | null;

  // ── Survey status ───────────────────────────────────────────────────────────

  @Index()
  @Column({ type: 'nvarchar', length: 50, nullable: true })
  survey_data_status!: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 50, nullable: true })
  survey_flow_status!: string | null;

  // ── P2: Purchase status ─────────────────────────────────────────────────────

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  p2_has_not_purchased_yet!: string | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  p2_still_considering!: string | null;

  // ── P3: Follow-up interest ──────────────────────────────────────────────────

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  p3_interest_follow_up!: string | null;

  // ── P4 Q1: Initial interest reasons (boolean flags) ─────────────────────────

  @Column({ type: 'bit', nullable: true })
  initial_interest_styling!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  initial_interest_brand!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  initial_interest_features!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  initial_interest_size!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  initial_interest_performance!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  initial_interest_price!: boolean | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  initial_interest_other!: string | null;

  // ── P4 Q2: Dealer visit ─────────────────────────────────────────────────────

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  dealer_visit!: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  vehicle_impression!: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  why_no_test_drive!: string | null;

  // ── P4 Q3: Dealership rating ────────────────────────────────────────────────

  @Column({ type: 'int', nullable: true })
  dealership_rating!: number | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  dealership_rating_feedback!: string | null;

  // ── P4 Q4: Not purchase reasons (boolean flags) ─────────────────────────────

  @Column({ type: 'bit', nullable: true })
  not_purchased_price!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  not_purchased_expectations!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  not_purchased_different_brand!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  not_purchased_different_model!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  not_purchased_financing!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  not_purchased_dealership!: boolean | null;

  @Column({ type: 'bit', nullable: true })
  purchased_moi_on_record!: boolean | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  not_purchased_other!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  not_purchased_price_feedback!: string | null;

  // ── P4 Q5: Competitor purchase ──────────────────────────────────────────────

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  purchased_another_vehicle!: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  purchased_make!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  purchased_model!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  purchased_other_model!: string | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  purchased_new_used!: string | null;

  // ── P4 Q6-Q9: Influence, reasoning, improvement ────────────────────────────

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  purchase_influence!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  purchase_reason!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  improve_anything!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  improve_follow_up!: string | null;

  // ── Agent notes ─────────────────────────────────────────────────────────────

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  agent_notes!: string | null;

  // ── Complaint ───────────────────────────────────────────────────────────────

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  complaint_type!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  complaint_type_category!: string | null;

  // ── Sync metadata ──────────────────────────────────────────────────────────

  @CreateDateColumn()
  synced_at!: Date;
}
