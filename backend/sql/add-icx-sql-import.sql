-- =============================================================================
-- SQL-source import staging columns (idempotent)
-- =============================================================================
-- Adds the staging columns needed for SQL-pulled sources (ICX call-centre
-- interactions, and survey responses attached to them) alongside the
-- existing file-upload staging pipeline in app.import_conversations.
--
-- app.interactions already has recordingUrl / maturityDate /
-- daysToMaturityAtInteraction (added for the telephony/manual-recording
-- pipeline) — only the staging table needs to catch up, so what the operator
-- reviews before promote is exactly what lands.
--
-- app.import_runs.intake ('upload' | 'server', now also 'sql') and
-- app.import_runs.notes (used to record the pulled date range) are both
-- already plain, unconstrained varchar/nvarchar columns — no migration
-- needed for either.
--
-- Run against the ai_insight database with a DDL-capable login.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.import_conversations') AND name = 'recordingUrl'
)
BEGIN
  ALTER TABLE app.import_conversations ADD recordingUrl varchar(2048) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.import_conversations') AND name = 'maturityDate'
)
BEGIN
  ALTER TABLE app.import_conversations ADD maturityDate datetime2 NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.import_conversations') AND name = 'daysToMaturityAtInteraction'
)
BEGIN
  ALTER TABLE app.import_conversations ADD daysToMaturityAtInteraction int NULL;
END;
GO
