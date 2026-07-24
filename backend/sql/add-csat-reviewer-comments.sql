-- =============================================================================
-- CSAT reviewer comments — free-text notes a reviewer adds in the UI while
-- reading a CSAT record's transcript side-by-side. Stored as a JSON array of
-- { user, comment, at } objects (never filtered/aggregated, so one blob column
-- per the column rule). Run against the ai_insight database. Idempotent.
-- =============================================================================

IF COL_LENGTH('app.interaction_csat', 'reviewerCommentsJson') IS NULL
BEGIN
  ALTER TABLE app.interaction_csat
    ADD reviewerCommentsJson nvarchar(MAX) NULL;
END;
GO
