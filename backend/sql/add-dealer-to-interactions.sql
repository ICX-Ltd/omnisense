-- =============================================================================
-- Adds a source-of-truth `dealer` column to app.interactions.
-- Run against the ai_assist database.
--
-- What this does:
--   1. Adds app.interactions.dealer (NVARCHAR(200) NULL)
--   2. Adds a supporting filtered index for dealer breakdowns / filters.
--
-- Populated upstream by the source data feed (like vehicleMake / campaign /
-- agent). The dashboard reads COALESCE(ia.dealer, ii.dealer_name) so this
-- source value takes precedence, falling back to the LLM-extracted dealer name
-- on app.interaction_insights when the source value is missing.
-- =============================================================================

-- ─── 1. app.interactions.dealer ─────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interactions')
    AND name = 'dealer'
)
BEGIN
  ALTER TABLE app.interactions
    ADD dealer NVARCHAR(200) NULL;
END;
GO

-- ─── 2. Index for dealer breakdown / filter ─────────────────────────────────
-- Supports the Client Services dashboard's dealer breakdown and drill-downs.
-- Filtered to non-null rows to keep the index small while adoption ramps up.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_interactions_dealer'
    AND object_id = OBJECT_ID('app.interactions')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_interactions_dealer
    ON app.interactions (dealer)
    INCLUDE (campaign, interactionType, effectiveDate)
    WHERE dealer IS NOT NULL;
END;
GO
