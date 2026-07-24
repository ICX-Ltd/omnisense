import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * interaction_survey — survey feed answers (the tick-box survey result that
 * arrives from the BI feed), tracked SEPARATELY from interaction_insights.
 *
 * Why its own table: survey answers are NOT LLM-generated — they come straight
 * from the source survey feed at data-load time. They used to be squeezed into
 * interaction_insights.campaign_answers_json (a column Parity also uses for
 * LLM-extracted Q&A). Because the insights run upserts the whole insight row and
 * nulls that column, a backfill script had to restore the survey copy after every
 * batch. Holding survey answers here — a table the LLM never writes — removes that
 * backfill entirely: the insights pipeline (which still runs on surveys for the
 * transcript-mined layer in campaign_transcript_json) can never clobber them.
 *
 * Column rule (same as interaction_insights / interaction_csat): `answersJson` is
 * the full survey answer blob = source of truth; a dedicated column exists only
 * where queries filter/group on it (campaign, surveyType).
 */
@Entity({ name: 'interaction_survey', schema: 'app' })
export class InteractionSurvey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // The interaction this survey response belongs to (= interaction.id). This is
  // the through-interaction link every survey query joins on.
  @Index('IX_interaction_survey_recording')
  @Column({ type: 'uniqueidentifier' })
  recordingId!: string;

  // Reference / rematch key from the feed (interaction.interactionTpsId).
  @Index('IX_interaction_survey_tpsid')
  @Column({ type: 'varchar', length: 50, nullable: true })
  interactionTpsId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  campaign!: string | null;

  // Survey "kind" — lets us hold different survey shapes and query per kind
  // (e.g. 'nmgb'). Indexed so the dashboard/overview can group on it.
  @Index('IX_interaction_survey_type')
  @Column({ type: 'varchar', length: 50, default: 'nmgb' })
  surveyType!: string;

  // Full survey answer blob (nested object: purchase_status.*, initial_interest.*,
  // not_purchased_reasons.*, competitor_purchase.*, influenced_by.*,
  // dealership_rating.*, meta.*). Same shape the readers already expect.
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  answersJson!: string | null;

  @Column({ type: 'datetime2', nullable: true })
  respondedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
