-- =============================================================================
-- Adds vehicleMake / vehicleModel columns to app.interactions.
-- Run against the ai_assist database.
--
-- What this does:
--   1. Adds app.interactions.vehicleMake  (NVARCHAR(100) NULL)
--   2. Adds app.interactions.vehicleModel (NVARCHAR(100) NULL)
--   3. Adds a supporting index for the Client Services dashboard filters.
--
-- Populated manually for now; the dashboard exposes them as filter dropdowns.
-- =============================================================================

-- ─── 1. app.interactions.vehicleMake ────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interactions')
    AND name = 'vehicleMake'
)
BEGIN
  ALTER TABLE app.interactions
    ADD vehicleMake NVARCHAR(100) NULL;
END;
GO

-- ─── 2. app.interactions.vehicleModel ───────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interactions')
    AND name = 'vehicleModel'
)
BEGIN
  ALTER TABLE app.interactions
    ADD vehicleModel NVARCHAR(100) NULL;
END;
GO

-- ─── 3. Index for dashboard filter ──────────────────────────────────────────
-- Supports the Client Services dashboard's vehicleMake / vehicleModel
-- dropdown filters. Filtered to non-null rows to keep the index small while
-- adoption ramps up.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_interactions_vehicleMake_vehicleModel'
    AND object_id = OBJECT_ID('app.interactions')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_interactions_vehicleMake_vehicleModel
    ON app.interactions (vehicleMake, vehicleModel)
    INCLUDE (campaign, interactionType, effectiveDate)
    WHERE vehicleMake IS NOT NULL;
END;
GO
