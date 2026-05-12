-- =============================================================================
-- Chat response-time metric columns
-- Run against the ai_assist database
-- Populated by the chat insights extractor when transcripts include
-- per-message timestamps. Auto-messages are excluded from the aggregates.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_insights')
    AND name = 'chat_response_avg_seconds'
)
BEGIN
  ALTER TABLE app.interaction_insights
    ADD chat_response_avg_seconds FLOAT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_insights')
    AND name = 'chat_response_longest_seconds'
)
BEGIN
  ALTER TABLE app.interaction_insights
    ADD chat_response_longest_seconds FLOAT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_insights')
    AND name = 'chat_response_last_seconds'
)
BEGIN
  ALTER TABLE app.interaction_insights
    ADD chat_response_last_seconds FLOAT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_insights')
    AND name = 'chat_response_sla_breach_count'
)
BEGIN
  ALTER TABLE app.interaction_insights
    ADD chat_response_sla_breach_count INT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_insights')
    AND name = 'chat_response_measured_count'
)
BEGIN
  ALTER TABLE app.interaction_insights
    ADD chat_response_measured_count INT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_insights')
    AND name = 'chat_response_metrics_json'
)
BEGIN
  ALTER TABLE app.interaction_insights
    ADD chat_response_metrics_json NVARCHAR(MAX) NULL;
END;
GO

-- Filtered index — only chats with at least one SLA breach are dashboard-interesting
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_insights_chat_sla_breach'
    AND object_id = OBJECT_ID('app.interaction_insights')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_insights_chat_sla_breach
    ON app.interaction_insights (chat_response_sla_breach_count)
    INCLUDE (recordingId, chat_response_avg_seconds, chat_response_longest_seconds)
    WHERE chat_response_sla_breach_count IS NOT NULL;
END;
GO
