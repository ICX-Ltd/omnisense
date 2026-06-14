-- =============================================================================
-- Adds per-record token-usage columns to app.interaction_insights for cost
-- tracking (no provider-console access needed).
-- Run against the ai_assist database. Idempotent.
--
--   insight_input_tokens         tokens of the SUCCESSFUL extraction attempt
--   insight_output_tokens        ditto (output dominates cost)
--   insight_attempts             how many attempts it took (1 = first-try)
--   insight_failed_input_tokens  tokens burned on FAILED attempts (retry waste)
--   insight_failed_output_tokens ditto
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.interaction_insights') AND name = 'insight_input_tokens')
  ALTER TABLE app.interaction_insights ADD insight_input_tokens INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.interaction_insights') AND name = 'insight_output_tokens')
  ALTER TABLE app.interaction_insights ADD insight_output_tokens INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.interaction_insights') AND name = 'insight_attempts')
  ALTER TABLE app.interaction_insights ADD insight_attempts INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.interaction_insights') AND name = 'insight_failed_input_tokens')
  ALTER TABLE app.interaction_insights ADD insight_failed_input_tokens INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.interaction_insights') AND name = 'insight_failed_output_tokens')
  ALTER TABLE app.interaction_insights ADD insight_failed_output_tokens INT NULL;
GO
