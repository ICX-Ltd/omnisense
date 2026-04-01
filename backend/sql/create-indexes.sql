-- =============================================================================
-- Performance indexes for auto-ignite-insights
-- Run against the ai_assist database
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1: Computed column + core indexes (covers ~80% of query patterns)
-- ─────────────────────────────────────────────────────────────────────────────

-- Every query filters on COALESCE(interactionDateTime, createdAt).
-- MSSQL can't index a COALESCE directly, so add a persisted computed column.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interactions') AND name = 'effectiveDate'
)
BEGIN
  ALTER TABLE app.interactions
    ADD effectiveDate AS COALESCE(interactionDateTime, createdAt) PERSISTED;
END;
GO

-- Core filter: date range + interaction type (every single query)
CREATE NONCLUSTERED INDEX IX_interactions_effectiveDate_type
  ON app.interactions (effectiveDate, interactionType)
  INCLUDE (campaign, agent, outcome);
GO

-- Filter options queries: distinct campaigns/agents/outcomes per channel
CREATE NONCLUSTERED INDEX IX_interactions_type_campaign
  ON app.interactions (interactionType, campaign)
  WHERE campaign IS NOT NULL;
GO

CREATE NONCLUSTERED INDEX IX_interactions_type_agent
  ON app.interactions (interactionType, agent)
  WHERE agent IS NOT NULL;
GO

CREATE NONCLUSTERED INDEX IX_interactions_type_outcome
  ON app.interactions (interactionType, outcome)
  WHERE outcome IS NOT NULL;
GO

-- FK join: every query joins interaction_insights.recordingId → interactions.id
-- Include overall_score and sentiment for covering common selects
CREATE NONCLUSTERED INDEX IX_insights_recordingId
  ON app.interaction_insights (recordingId)
  INCLUDE (overall_score, sentiment_overall, campaign_detected, contact_disposition);
GO

-- Score range queries (score distribution buckets, lowest scored, ops drill-down)
CREATE NONCLUSTERED INDEX IX_insights_overall_score
  ON app.interaction_insights (overall_score)
  INCLUDE (recordingId, summary_short, campaign_detected, contact_disposition, coaching_json)
  WHERE overall_score IS NOT NULL;
GO

-- Sentiment sort (best/worst sentiment examples)
CREATE NONCLUSTERED INDEX IX_insights_sentiment
  ON app.interaction_insights (sentiment_overall)
  INCLUDE (recordingId, summary_short, campaign_detected)
  WHERE sentiment_overall IS NOT NULL;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2: Aggregation indexes (GROUP BY patterns)
-- ─────────────────────────────────────────────────────────────────────────────

-- GROUP BY campaign_detected (general metrics, compliance, client services)
CREATE NONCLUSTERED INDEX IX_insights_campaign_detected
  ON app.interaction_insights (campaign_detected)
  INCLUDE (recordingId);
GO

-- GROUP BY contact_disposition (general metrics)
-- Already has single-column index from entity, but add recordingId for covering
CREATE NONCLUSTERED INDEX IX_insights_disposition_covering
  ON app.interaction_insights (contact_disposition)
  INCLUDE (recordingId);
GO

-- GROUP BY interest_level (general + client services metrics)
CREATE NONCLUSTERED INDEX IX_insights_interest_covering
  ON app.interaction_insights (interest_level)
  INCLUDE (recordingId);
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3: JSON column + boolean filters
-- ─────────────────────────────────────────────────────────────────────────────

-- Dimension averages: operations_scores_json IS NOT NULL (called 2-3x per load)
CREATE NONCLUSTERED INDEX IX_insights_has_ops_scores
  ON app.interaction_insights (recordingId)
  WHERE operations_scores_json IS NOT NULL;
GO

-- Coaching needs: coaching_json IS NOT NULL + OPENJSON
CREATE NONCLUSTERED INDEX IX_insights_has_coaching
  ON app.interaction_insights (recordingId)
  WHERE coaching_json IS NOT NULL;
GO

-- Objections: objections_json IS NOT NULL
CREATE NONCLUSTERED INDEX IX_insights_has_objections
  ON app.interaction_insights (recordingId)
  WHERE objections_json IS NOT NULL;
GO

-- Campaign compliance: campaign_compliance_json IS NOT NULL
CREATE NONCLUSTERED INDEX IX_insights_has_compliance
  ON app.interaction_insights (recordingId)
  WHERE campaign_compliance_json IS NOT NULL;
GO

-- Client services: competitor/lead/lost sale boolean filters
CREATE NONCLUSTERED INDEX IX_insights_purchased_elsewhere
  ON app.interaction_insights (has_purchased_elsewhere)
  INCLUDE (recordingId, competitor_purchased, objections_json)
  WHERE has_purchased_elsewhere = 1;
GO

CREATE NONCLUSTERED INDEX IX_insights_lead_generated
  ON app.interaction_insights (lead_generated_for_dealer)
  INCLUDE (recordingId, dealer_name)
  WHERE lead_generated_for_dealer = 1;
GO

CREATE NONCLUSTERED INDEX IX_insights_lost_sale
  ON app.interaction_insights (lost_sale)
  INCLUDE (recordingId, summary_short, competitor_purchased, campaign_detected)
  WHERE lost_sale = 1;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4: Transcript + narrative lookups
-- ─────────────────────────────────────────────────────────────────────────────

-- Transcript lookup by recordingId (detail drawer)
CREATE NONCLUSTERED INDEX IX_transcripts_recordingId
  ON app.interaction_transcripts (recordingId);
GO

-- Narrative listing: filterKey LIKE + narrativeType + createdAt ordering
CREATE NONCLUSTERED INDEX IX_summaries_filterKey_created
  ON app.insight_summaries (filterKey, narrativeType, createdAt DESC);
GO

-- Narrative listing: createdAt range filter
CREATE NONCLUSTERED INDEX IX_summaries_createdAt
  ON app.insight_summaries (createdAt DESC)
  INCLUDE (filterKey, narrativeType);
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 5: Agents-in-data query (ops dashboard)
-- ─────────────────────────────────────────────────────────────────────────────

-- GROUP BY ia.agent with AVG(overall_score) — needs agent on interactions
-- plus the join to insights. The IX_interactions_type_agent + IX_insights_recordingId
-- cover this, but an explicit covering index helps:
CREATE NONCLUSTERED INDEX IX_interactions_agent_date
  ON app.interactions (agent, effectiveDate)
  INCLUDE (interactionType, campaign, outcome)
  WHERE agent IS NOT NULL AND agent != '';
GO
