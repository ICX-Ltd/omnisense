-- =============================================================================
-- Prompt-version stamping — record which prompt fragments (and version of each)
-- produced every insight, for reproducibility / audit and golden-set A/B.
-- Run against the ai_insight database. Idempotent.
--
-- Stored as a JSON map, e.g. {"call.base": 4, "call.campaign.MFS": 2, ...}.
-- Existing rows stay NULL (written before stamping) and backfill on re-run.
-- =============================================================================

IF COL_LENGTH('app.interaction_insights', 'prompt_versions_json') IS NULL
BEGIN
  ALTER TABLE app.interaction_insights
    ADD prompt_versions_json nvarchar(MAX) NULL;
END;
GO
