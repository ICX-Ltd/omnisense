import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * interaction_csat — CSAT contest assessment, tracked SEPARATELY from the
 * standard pending→transcribe→insights pipeline. A CSAT score arrives from a
 * third party (webhook feed), is matched to an interaction by interactionTpsId,
 * then a campaign-specific "should this CSAT be contested?" assessment is run
 * against the transcript. This table has its OWN status lifecycle so CSAT volume
 * never mixes into the main interaction stats.
 *
 * Column rule (same as interaction_insights): `json` is the full raw LLM output
 * = source of truth. A dedicated column exists only where the board/queries need
 * to filter/group/aggregate on it (status, decision, score, campaign).
 */
@Entity({ name: 'interaction_csat', schema: 'app' })
export class InteractionCsat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Match key from the feed. Unique so re-ingesting the same survey upserts.
  @Index('IX_interaction_csat_tpsid', { unique: true })
  @Column({ type: 'varchar', length: 50 })
  interactionTpsId!: string;

  // Matched interaction (null while unmatched — the interaction may not exist yet).
  @Index('IX_interaction_csat_recording')
  @Column({ type: 'uniqueidentifier', nullable: true })
  recordingId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  campaign!: string | null;

  // ── Imported CSAT survey data ────────────────────────────────────────────
  @Column({ type: 'int', nullable: true })
  score!: number | null;

  @Column({ type: 'int', nullable: true })
  scoreMax!: number | null; // scale ceiling (e.g. 5 or 10), for interpretation

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  comment!: string | null; // free-text survey comment

  @Column({ type: 'datetime2', nullable: true })
  respondedAt!: Date | null;

  // Original webhook payload, kept verbatim for audit / re-processing.
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  rawFeedJson!: string | null;

  // ── Assessment lifecycle (separate from interaction.status) ──────────────
  // pending | awaiting_transcript | assessing | assessed | error | unmatched
  @Index('IX_interaction_csat_status')
  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status!: string;

  @Column({ type: 'nvarchar', length: 1024, nullable: true })
  lastError!: string | null;

  // ── Assessment result ────────────────────────────────────────────────────
  // contest | do_not_contest | unclear
  @Index('IX_interaction_csat_decision')
  @Column({ type: 'varchar', length: 20, nullable: true })
  decision!: string | null;

  @Column({ type: 'float', nullable: true })
  confidence!: number | null;

  // Where the dissatisfaction originated (final_agent | dealership | business |
  // product | pricing | delay | customer_behaviour | outside_scope | unclear).
  @Column({ type: 'varchar', length: 40, nullable: true })
  dissatisfaction_source!: string | null;

  // Did the final agent cause / materially worsen the dissatisfaction?
  @Column({ type: 'bit', nullable: true })
  agent_materially_contributed!: boolean | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  rationale!: string | null;

  // Full raw LLM output — source of truth (factors, rules_triggered, quotes…).
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  json!: string | null;

  // ── Provenance / cost ─────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 50, nullable: true })
  providerUsed!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  prompt_versions_json!: string | null;

  @Column({ type: 'int', nullable: true })
  input_tokens!: number | null;

  @Column({ type: 'int', nullable: true })
  output_tokens!: number | null;

  @Column({ type: 'int', nullable: true })
  attempts!: number | null;

  // ── Supervisor review of the AI decision ─────────────────────────────────
  // A CSAT supervisor either ACCEPTS the AI recommendation or DISAGREES with it.
  // The business OUTCOME is what matters: a record is "raise with client" when
  // the supervisor accepts a CONTEST, or disagrees with a DO NOT CONTEST — those
  // are the records we export and pass back. reviewOutcome holds that derived
  // verdict; reviewAction records what the supervisor did relative to the AI.
  // Both null = not yet reviewed. reviewOutcome indexed (the board KPIs group on it).
  @Index('IX_interaction_csat_review')
  @Column({ type: 'varchar', length: 20, nullable: true })
  reviewOutcome!: string | null; // 'raise_with_client' | 'do_not_raise'

  @Column({ type: 'varchar', length: 20, nullable: true })
  reviewAction!: string | null; // 'accept' | 'disagree'

  @Column({ type: 'varchar', length: 120, nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'datetime2', nullable: true })
  reviewedAt!: Date | null;

  // ── Reviewer comments ─────────────────────────────────────────────────────
  // Free-text notes a reviewer adds in the UI while reading the transcript
  // side-by-side. JSON array of { user, comment, at } — never filtered or
  // aggregated in SQL, so it stays a single json blob per the column rule.
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  reviewerCommentsJson!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime2', nullable: true })
  assessedAt!: Date | null;
}
