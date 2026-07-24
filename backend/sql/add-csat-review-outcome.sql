-- =============================================================================
-- CSAT supervisor review — accept / disagree with the AI decision
-- =============================================================================
-- A CSAT supervisor reviews each assessed record and either ACCEPTS the AI
-- decision or DISAGREES with it. The derived business outcome (reviewOutcome) is
-- 'raise_with_client' when they accept a CONTEST or disagree with a DO NOT
-- CONTEST — those are the records we export and pass back — else 'do_not_raise'.
-- reviewAction records the raw accept/disagree. Stored with who + when. Run
-- against the ai_insight database. Idempotent.
-- =============================================================================

IF COL_LENGTH('app.interaction_csat', 'reviewOutcome') IS NULL
  ALTER TABLE app.interaction_csat ADD reviewOutcome varchar(20) NULL;
GO
IF COL_LENGTH('app.interaction_csat', 'reviewAction') IS NULL
  ALTER TABLE app.interaction_csat ADD reviewAction varchar(20) NULL;
GO
IF COL_LENGTH('app.interaction_csat', 'reviewedBy') IS NULL
  ALTER TABLE app.interaction_csat ADD reviewedBy varchar(120) NULL;
GO
IF COL_LENGTH('app.interaction_csat', 'reviewedAt') IS NULL
  ALTER TABLE app.interaction_csat ADD reviewedAt datetime2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_csat_review' AND object_id = OBJECT_ID('app.interaction_csat'))
  CREATE INDEX IX_interaction_csat_review ON app.interaction_csat (reviewOutcome);
GO
