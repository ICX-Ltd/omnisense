-- =============================================================================
-- interaction_insights tidy-up: drop dead columns.
-- Run against the ai_insight database. Idempotent.
--
-- key_entities_json and data_quality_json were written on every insight but
-- never read anywhere (no query, no drawer, no frontend). The same data still
-- lives in the raw `json` blob, so nothing is lost. Per the column-governance
-- rule (see interaction-insight.entity.ts header), a field with no query or
-- display need does not get a dedicated column.
-- =============================================================================

IF COL_LENGTH('app.interaction_insights', 'key_entities_json') IS NOT NULL
BEGIN
  ALTER TABLE app.interaction_insights DROP COLUMN key_entities_json;
END;
GO

IF COL_LENGTH('app.interaction_insights', 'data_quality_json') IS NOT NULL
BEGIN
  ALTER TABLE app.interaction_insights DROP COLUMN data_quality_json;
END;
GO
